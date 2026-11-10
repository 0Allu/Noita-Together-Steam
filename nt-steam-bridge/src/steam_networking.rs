//! Steam lobby session + P2P connections.
//!
//! Ported from Noita Entangled Worlds (`noita_proxy/src/net/steam_networking.rs`,
//! MIT OR Apache-2.0). Differences from upstream:
//! - No dependency on `tangled`, translations or EW's version type; the app
//!   checks lobby metadata itself.
//! - Star topology instead of a full mesh: Noita Together's room logic runs on
//!   the host, so clients only connect to the lobby owner and the owner
//!   connects to everyone.
//! - Single threaded (callbacks run on the main loop), so the `DashMap`/`Mutex`
//!   wrappers became plain collections.
//! - Results are reported as protocol `Event`s for the app.

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    mem,
    time::{Duration, Instant},
};

use base64::Engine;
use crossbeam_channel as channel;
use steamworks::{
    networking_sockets::{ListenSocket, NetConnection, NetPollGroup},
    networking_types::{
        ListenSocketEvent, NetConnectionEnd, NetworkingConnectionState, NetworkingIdentity,
        SendFlags,
    },
    CallbackHandle, Client, ClientManager, LobbyChatUpdate, LobbyId, LobbyType, Matchmaking,
    SteamError, SteamId,
};
use tracing::{error, info, warn};

use crate::{
    lobby_code,
    protocol::{Event, LobbyInfo},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reliability {
    Reliable,
    Unreliable,
}

enum SteamEvent {
    LobbyCreatedOrJoined(LobbyId),
    LobbyError(String),
    PeerStateChanged,
}

enum ConnectionState {
    AwaitingIncoming,
    NetConnectionPending(NetConnection<ClientManager>),
    NetConnection(NetConnection<ClientManager>),
}

impl ConnectionState {
    fn switch_to_connected(&mut self) {
        let current = mem::replace(self, ConnectionState::AwaitingIncoming);
        if let ConnectionState::NetConnectionPending(conn) = current {
            *self = ConnectionState::NetConnection(conn);
        }
    }
    fn connection(&self) -> Option<&NetConnection<ClientManager>> {
        if let ConnectionState::NetConnection(conn) = self {
            Some(conn)
        } else {
            None
        }
    }
    fn into_connection(self) -> Option<NetConnection<ClientManager>> {
        match self {
            ConnectionState::AwaitingIncoming => None,
            ConnectionState::NetConnectionPending(conn) | ConnectionState::NetConnection(conn) => {
                Some(conn)
            }
        }
    }
}

/// How long a peer's backlog may stay non-empty before we give up on the peer.
const SEND_BACKLOG_TIMEOUT: Duration = Duration::from_secs(30);
const SEND_BACKLOG_REPORT_INTERVAL: Duration = Duration::from_secs(5);

/// Reliable messages Steam refused with `LimitExceeded`, held in order until it has room.
struct SendBacklog {
    messages: VecDeque<Vec<u8>>,
    bytes: usize,
    peak_messages: usize,
    peak_bytes: usize,
    /// Time of the first refusal.
    since: Instant,
    last_report: Instant,
    last_error: Option<SteamError>,
}

enum BacklogState {
    Drained,
    Waiting,
    Stuck,
}

impl SendBacklog {
    fn new(first: Vec<u8>, now: Instant) -> Self {
        let mut backlog = Self {
            messages: VecDeque::new(),
            bytes: 0,
            peak_messages: 0,
            peak_bytes: 0,
            since: now,
            last_report: now,
            last_error: Some(SteamError::LimitExceeded),
        };
        backlog.push(first);
        backlog
    }

    fn push(&mut self, msg: Vec<u8>) {
        self.bytes += msg.len();
        self.messages.push_back(msg);
        self.peak_messages = self.peak_messages.max(self.messages.len());
        self.peak_bytes = self.peak_bytes.max(self.bytes);
    }

    /// Sends oldest first, stopping at the first refusal. Only an empty backlog
    /// resets the timeout.
    fn drain(
        &mut self,
        now: Instant,
        mut send: impl FnMut(&[u8]) -> Result<(), SteamError>,
    ) -> BacklogState {
        while let Some(msg) = self.messages.front() {
            let len = msg.len();
            if let Err(err) = send(msg) {
                self.last_error = Some(err);
                break;
            }
            self.messages.pop_front();
            self.bytes -= len;
        }
        if self.messages.is_empty() {
            BacklogState::Drained
        } else if now.duration_since(self.since) >= SEND_BACKLOG_TIMEOUT {
            BacklogState::Stuck
        } else {
            BacklogState::Waiting
        }
    }

    fn report_due(&mut self, now: Instant) -> bool {
        if now.duration_since(self.last_report) >= SEND_BACKLOG_REPORT_INTERVAL {
            self.last_report = now;
            true
        } else {
            false
        }
    }
}

struct Connections {
    client: Client,

    my_id: SteamId,
    listen_socket: ListenSocket<ClientManager>,
    poll_group: NetPollGroup<ClientManager>,

    peers: HashMap<SteamId, ConnectionState>,
    newly_connected: Vec<SteamId>,
    backlogs: HashMap<SteamId, SendBacklog>,
}

impl Connections {
    fn new(client: &Client) -> Self {
        let my_id = client.user().steam_id();
        let networking_sockets = client.networking_sockets();
        let listen_socket = networking_sockets
            .create_listen_socket_p2p(0, None)
            .expect("handle to be valid"); // Unclear in what cases this can fail.
        let poll_group = networking_sockets.create_poll_group();
        Connections {
            client: client.clone(),

            my_id,
            listen_socket,
            poll_group,

            peers: Default::default(),
            newly_connected: Default::default(),
            backlogs: Default::default(),
        }
    }

    fn flush(&self) {
        for state in self.peers.values() {
            if let Some(c) = state.connection() {
                if let Err(err) = c.flush_messages() {
                    warn!("Error while flushing a message: {err:?}")
                }
            }
        }
    }

    fn poll_listener(&mut self) {
        while let Some(event) = self.listen_socket.try_receive_event() {
            match event {
                ListenSocketEvent::Connecting(event) => {
                    info!("Peer {:?} connecting", event.remote());
                    event
                        .accept()
                        .inspect_err(|e| warn!("Error when accepting connection: {}", e))
                        .ok();
                }
                ListenSocketEvent::Connected(event) => {
                    if let Some(connection) = event
                        .remote()
                        .steam_id()
                        .and_then(|x| self.peers.get_mut(&x))
                    {
                        info!("Peer {:?} got connected event", event.remote());
                        let taken_connection = event.take_connection();
                        taken_connection.set_poll_group(&self.poll_group);
                        *connection = ConnectionState::NetConnectionPending(taken_connection);
                    }
                }
                ListenSocketEvent::Disconnected(event) => {
                    info!(
                        "Peer {:?} disconnected, reason: {:?}",
                        event.remote(),
                        event.end_reason(),
                    )
                }
            }
        }
    }

    fn poll_status(&mut self) {
        let networking_sockets = self.client.networking_sockets();
        // Postpone reconnect so we don't mutate the map while iterating it.
        let mut pending_reconnect = Vec::new();
        for (peer, state) in self.peers.iter_mut() {
            match state {
                ConnectionState::AwaitingIncoming => {}
                ConnectionState::NetConnectionPending(connection) => {
                    let info = networking_sockets
                        .get_connection_info(connection)
                        .expect("handle to be valid");
                    match info.state().expect("assuming state is always valid") {
                        // Wait.
                        NetworkingConnectionState::Connecting
                        | NetworkingConnectionState::FindingRoute => {}
                        // Switch to connected state.
                        NetworkingConnectionState::Connected => {
                            info!("Connection of peer {:?} switched to connected state", peer);
                            self.newly_connected.push(*peer);
                            state.switch_to_connected();
                        }
                        NetworkingConnectionState::None
                        | NetworkingConnectionState::ClosedByPeer
                        | NetworkingConnectionState::ProblemDetectedLocally => {
                            info!(
                                "Some problem happened for peer {:?} while making connection. Will try to connect again.",
                                peer
                            );
                            pending_reconnect.push(*peer);
                        }
                    }
                }
                ConnectionState::NetConnection(connection) => {
                    let info = networking_sockets
                        .get_connection_info(connection)
                        .expect("handle to be valid");
                    match info.state().expect("assuming state is always valid") {
                        NetworkingConnectionState::Connecting
                        | NetworkingConnectionState::FindingRoute => {
                            // Not supposed to happen, as we're in NetConnectionPending state while connecting.
                            warn!("Not supposed to be in connecting state here.");
                            pending_reconnect.push(*peer);
                        }
                        NetworkingConnectionState::Connected => {
                            // All is ok, no need to do anything.
                        }
                        NetworkingConnectionState::None
                        | NetworkingConnectionState::ClosedByPeer
                        | NetworkingConnectionState::ProblemDetectedLocally => {
                            // Something broke, we need to recreate the connection.
                            info!(
                                "Some problem happened for peer {:?} while connection was established. Will try to connect again.",
                                peer
                            );
                            pending_reconnect.push(*peer);
                        }
                    }
                }
            }
        }
        for peer_id in pending_reconnect {
            self.connect(peer_id);
        }
    }

    fn poll(&mut self) {
        self.poll_listener();
        self.poll_status();
    }

    fn connect(&mut self, peer: SteamId) {
        let networking_sockets = self.client.networking_sockets();
        let peer_identity = NetworkingIdentity::new_steam_id(peer);
        // Exactly one side of each pair initiates; the other waits on its listen socket.
        if peer > self.my_id {
            info!("Awaiting incoming connection from {:?}", peer);
            self.peers.insert(peer, ConnectionState::AwaitingIncoming);
        } else {
            info!("Initiating connection to {:?}", peer);
            let connection = networking_sockets
                .connect_p2p(peer_identity, 0, None)
                .expect("handle to be valid");
            connection.set_poll_group(&self.poll_group);
            self.peers
                .insert(peer, ConnectionState::NetConnectionPending(connection));
        }
    }

    fn disconnect(&mut self, id: SteamId) {
        info!("Removing connection to peer {:?}", id);
        self.peers.remove(&id);
        self.backlogs.remove(&id);
    }

    /// Close every connection, giving Steam a chance to deliver what's still queued.
    fn close_all(&mut self) {
        self.flush();
        for (_, state) in self.peers.drain() {
            if let Some(conn) = state.into_connection() {
                conn.close(NetConnectionEnd::AppGeneric, Some("leaving lobby"), true);
            }
        }
        self.backlogs.clear();
    }

    fn recv(&mut self) -> Vec<steamworks::networking_types::NetworkingMessage<ClientManager>> {
        self.poll_group.receive_messages(1024)
    }

    fn send_message(
        &mut self,
        peer: SteamId,
        reliability: Reliability,
        msg: &[u8],
    ) -> Result<(), SteamError> {
        if reliability == Reliability::Unreliable {
            return self.send_now(peer, SendFlags::UNRELIABLE, msg);
        }
        // Don't overtake anything already waiting.
        if let Some(backlog) = self.backlogs.get_mut(&peer) {
            backlog.push(msg.to_vec());
            return Ok(());
        }
        match self.send_now(peer, SendFlags::RELIABLE, msg) {
            Err(SteamError::LimitExceeded) => {
                warn!(
                    "Steam's send buffer for peer {:?} is full; holding reliable messages to it until there is room",
                    peer
                );
                self.backlogs
                    .insert(peer, SendBacklog::new(msg.to_vec(), Instant::now()));
                Ok(())
            }
            res => res,
        }
    }

    /// Retries every backlog. Returns the peers whose backlog timed out; those
    /// backlogs are dropped.
    fn drain_backlogs(&mut self) -> Vec<SteamId> {
        let now = Instant::now();
        let mut stuck = Vec::new();
        let peers = &self.peers;
        self.backlogs.retain(|&peer, backlog| {
            // Not `send_now`: it reports success when the peer isn't connected yet.
            let connection = peers.get(&peer).and_then(|state| state.connection());
            let state = backlog.drain(now, |msg| match connection {
                Some(connection) => connection
                    .send_message(msg, SendFlags::RELIABLE)
                    .map(|_| ()),
                None => Err(SteamError::NoConnection),
            });
            let waited = now.duration_since(backlog.since).as_secs_f32();
            match state {
                BacklogState::Drained => {
                    warn!(
                        "Steam's send buffer for peer {:?} has room again after {:.1}s; the backlog peaked at {} reliable messages ({} bytes)",
                        peer, waited, backlog.peak_messages, backlog.peak_bytes
                    );
                    false
                }
                BacklogState::Waiting => {
                    if backlog.report_due(now) {
                        warn!(
                            "Reliable messages to peer {:?} still backed up after {:.1}s: {} messages ({} bytes) waiting, last refusal {:?}",
                            peer,
                            waited,
                            backlog.messages.len(),
                            backlog.bytes,
                            backlog.last_error
                        );
                    }
                    true
                }
                BacklogState::Stuck => {
                    error!(
                        "Giving up on reliable messages to peer {:?} after {:.1}s: dropping {} messages ({} bytes), last refusal {:?}",
                        peer,
                        waited,
                        backlog.messages.len(),
                        backlog.bytes,
                        backlog.last_error
                    );
                    stuck.push(peer);
                    false
                }
            }
        });
        stuck
    }

    fn send_now(&self, peer: SteamId, send_flags: SendFlags, msg: &[u8]) -> Result<(), SteamError> {
        if let Some(peer) = self.peers.get(&peer) {
            if let Some(connection) = peer.connection() {
                connection.send_message(msg, send_flags)?;
                Ok(())
            } else {
                // Not connected yet. The app only sends after `PeerConnected`, so this
                // only happens while a connection is being re-established.
                Ok(())
            }
        } else {
            Err(SteamError::InvalidSteamID)
        }
    }
}

/// One lobby membership (as host or as client) plus its P2P connections.
pub struct Session {
    client: Client,
    events: channel::Receiver<SteamEvent>,
    sender: channel::Sender<SteamEvent>,
    my_id: SteamId,
    is_host: bool,
    lobby_id: Option<LobbyId>,
    host_id: SteamId,
    /// Other lobby members, sorted.
    members: Vec<SteamId>,
    _cbs: Vec<CallbackHandle>,

    connections: Connections,
}

impl Session {
    pub fn new_host(
        client: Client,
        lobby_type: LobbyType,
        max_members: u32,
        data: BTreeMap<String, String>,
    ) -> Self {
        let (sender, events) = channel::unbounded();
        let connections = Connections::new(&client);

        let matchmaking = client.matchmaking();
        {
            let sender = sender.clone();
            matchmaking.create_lobby(lobby_type, max_members.clamp(1, 250), {
                let client = client.clone();
                move |lobby| {
                    let matchmaking = client.matchmaking();
                    let event = match lobby {
                        Ok(id) => {
                            for (key, value) in &data {
                                matchmaking.set_lobby_data(id, key, value);
                            }
                            SteamEvent::LobbyCreatedOrJoined(id)
                        }
                        Err(err) => SteamEvent::LobbyError(format!("Could not create lobby: {err}")),
                    };
                    sender.send(event).ok();
                }
            });
        }

        let my_id = client.user().steam_id();
        let _cbs = make_callbacks(&sender, &client);
        Self {
            my_id,
            client,
            events,
            sender,
            is_host: true,
            lobby_id: None,
            host_id: my_id,
            members: Vec::new(),
            _cbs,
            connections,
        }
    }

    pub fn new_connect(lobby: LobbyId, client: Client) -> Self {
        let (sender, events) = channel::unbounded();
        let connections = Connections::new(&client);
        let matchmaking = client.matchmaking();
        {
            let sender = sender.clone();
            matchmaking.join_lobby(lobby, move |lobby| {
                let event = match lobby {
                    Ok(id) => SteamEvent::LobbyCreatedOrJoined(id),
                    Err(_) => SteamEvent::LobbyError(
                        "Could not join the Steam lobby. It may no longer exist.".to_string(),
                    ),
                };
                sender.send(event).ok();
            });
        }

        let my_id = client.user().steam_id();
        let _cbs = make_callbacks(&sender, &client);
        Self {
            my_id,
            client,
            events,
            sender,
            is_host: false,
            lobby_id: None,
            host_id: my_id,
            members: Vec::new(),
            _cbs,
            connections,
        }
    }

    pub fn flush(&self) {
        self.connections.flush()
    }

    pub fn send_message(
        &mut self,
        peer: SteamId,
        msg: &[u8],
        reliability: Reliability,
    ) -> Result<(), SteamError> {
        self.connections.send_message(peer, reliability, msg)
    }

    pub fn set_lobby_data(&self, data: &BTreeMap<String, String>) {
        if !self.is_host {
            return;
        }
        if let Some(id) = self.lobby_id {
            let matchmaking = self.client.matchmaking();
            for (key, value) in data {
                matchmaking.set_lobby_data(id, key, value);
            }
        }
    }

    /// Poll Steam and translate everything that happened into app events.
    pub fn recv(&mut self) -> Vec<Event> {
        self.connections.poll();
        let mut out = Vec::new();
        for peer in self.connections.drain_backlogs() {
            out.push(Event::SendStuck {
                steam_id: peer.raw().to_string(),
            });
        }
        let events: Vec<SteamEvent> = self.events.try_iter().collect();
        for event in events {
            match event {
                SteamEvent::LobbyCreatedOrJoined(id) => {
                    info!("Lobby ready");
                    self.lobby_id = Some(id);
                    let matchmaking = self.client.matchmaking();
                    if self.is_host {
                        out.push(Event::LobbyCreated {
                            lobby_id: id.raw().to_string(),
                            code: lobby_code::serialize(id),
                        });
                    } else {
                        self.host_id = matchmaking.lobby_owner(id);
                        info!("Got host id: {:?}", self.host_id);
                        out.push(Event::LobbyJoined {
                            lobby_id: id.raw().to_string(),
                            code: lobby_code::serialize(id),
                            owner_id: self.host_id.raw().to_string(),
                            data: all_lobby_data(&matchmaking, id),
                        });
                    }
                    self.update_lobby_list(&mut out);
                }
                SteamEvent::LobbyError(reason) => {
                    warn!("{reason}");
                    if self.is_host {
                        out.push(Event::LobbyCreateFailed { reason });
                    } else {
                        out.push(Event::LobbyJoinFailed { reason });
                    }
                }
                SteamEvent::PeerStateChanged => self.update_lobby_list(&mut out),
            }
        }

        // Report new connections before the messages that may have arrived on them.
        let friends = self.client.friends();
        for steam_id in self.connections.newly_connected.drain(..) {
            out.push(Event::PeerConnected {
                steam_id: steam_id.raw().to_string(),
                name: friends.get_friend(steam_id).name(),
            });
        }

        let engine = base64::engine::general_purpose::STANDARD;
        for message in self.connections.recv() {
            let Some(steam_id) = message.identity_peer().steam_id() else {
                continue;
            };
            out.push(Event::Message {
                from: steam_id.raw().to_string(),
                data: engine.encode(message.data()),
            });
        }

        out
    }

    /// Should we hold a connection to this lobby member? Clients only talk to the host.
    fn should_connect(&self, peer: SteamId) -> bool {
        self.is_host || peer == self.host_id
    }

    fn update_lobby_list(&mut self, out: &mut Vec<Event>) {
        let Some(lobby_id) = self.lobby_id else {
            return;
        };
        let matchmaking = self.client.matchmaking();
        let friends = self.client.friends();
        let mut peers = matchmaking.lobby_members(lobby_id);
        peers.retain(|x| *x != self.my_id);
        peers.sort();

        for peer in &peers {
            if !self.members.contains(peer) {
                out.push(Event::PeerJoined {
                    steam_id: peer.raw().to_string(),
                    name: friends.get_friend(*peer).name(),
                });
                if self.should_connect(*peer) {
                    self.connections.connect(*peer);
                }
            }
        }
        let gone: Vec<SteamId> = self
            .members
            .iter()
            .filter(|peer| !peers.contains(peer))
            .copied()
            .collect();
        for peer in gone {
            self.connections.disconnect(peer);
            out.push(Event::PeerLeft {
                steam_id: peer.raw().to_string(),
            });
        }

        self.members = peers;
        info!("Current peer list: {:?}", self.members);
    }
}

fn make_callbacks(sender: &channel::Sender<SteamEvent>, client: &Client) -> Vec<CallbackHandle> {
    let sender = sender.clone();
    let cb = client.register_callback(move |update: LobbyChatUpdate| {
        info!("User state changed {:?}", update);
        sender.send(SteamEvent::PeerStateChanged).ok();
    });
    vec![cb]
}

impl Drop for Session {
    fn drop(&mut self) {
        self.connections.close_all();
        if let Some(lobby) = self.lobby_id {
            self.client.matchmaking().leave_lobby(lobby);
        }
        // Keep `sender` alive until here so late callbacks never hit a closed channel.
        let _ = &self.sender;
    }
}

pub fn all_lobby_data(matchmaking: &Matchmaking<ClientManager>, id: LobbyId) -> BTreeMap<String, String> {
    (0..matchmaking.lobby_data_count(id))
        .filter_map(|i| matchmaking.lobby_data_by_index(id, i))
        .collect()
}

pub fn lobby_info(matchmaking: &Matchmaking<ClientManager>, id: LobbyId) -> LobbyInfo {
    LobbyInfo {
        lobby_id: id.raw().to_string(),
        code: lobby_code::serialize(id),
        members: matchmaking.lobby_member_count(id),
        max_members: matchmaking.lobby_member_limit(id).unwrap_or(250),
        data: all_lobby_data(matchmaking, id),
    }
}
