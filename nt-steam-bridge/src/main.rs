//! nt-steam-bridge: gives the Noita Together app Steam lobbies and Steam P2P
//! networking, replacing the retired noitatogether.com lobby server.
//!
//! The app spawns this process and talks to it over stdin/stdout using
//! newline-delimited JSON (see `protocol.rs`). Logs go to stderr.
//!
//! Like Noita Entangled Worlds, it initializes Steam as Noita (app id 881100),
//! so it only needs Steam running and a copy of Noita on the account; no
//! separate Steam app id or server is involved.

mod lobby_code;
mod protocol;
mod steam_networking;

use std::{
    collections::{BTreeMap, VecDeque},
    io::BufRead,
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use crossbeam_channel::TryRecvError;
use steamworks::{
    DistanceFilter, GameLobbyJoinRequested, LobbyKey, LobbyType, SteamId, StringFilter,
    StringFilterKind,
};
use tracing::{info, warn};

use protocol::{Command, Event, LobbyVisibility, Out};
use steam_networking::{Reliability, Session};

const NOITA_APP_ID: u32 = 881100;
const TICK: Duration = Duration::from_millis(3);

fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("NT_STEAM_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let out = Out::new();
    let app_id = std::env::var("NT_STEAM_APPID")
        .ok()
        .and_then(|x| x.parse().ok())
        .unwrap_or(NOITA_APP_ID);

    info!("Initializing steam client with app id {app_id}...");
    let (client, single) = match steamworks::Client::init_app(app_id) {
        Ok(x) => x,
        Err(err) => {
            out.emit(&Event::InitFailed {
                reason: format!(
                    "Could not initialize Steam ({err}). Make sure Steam is running and that you own Noita."
                ),
            });
            std::process::exit(1);
        }
    };
    info!("Initializing relay network access...");
    client.networking_utils().init_relay_network_access();
    if let Err(err) = client.networking_sockets().init_authentication() {
        warn!("Failed to init_authentication: {}", err)
    }

    out.emit(&Event::Ready {
        steam_id: client.user().steam_id().raw().to_string(),
        name: client.friends().name(),
        app_id,
    });

    // Steam invites / "Join game" from the friends list.
    let _join_cb = {
        let out = out.clone();
        client.register_callback(move |req: GameLobbyJoinRequested| {
            out.emit(&Event::JoinRequested {
                lobby_id: req.lobby_steam_id.raw().to_string(),
                code: lobby_code::serialize(req.lobby_steam_id),
            });
        })
    };

    let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded();
    thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Command>(&line) {
                Ok(cmd) => {
                    if cmd_tx.send(cmd).is_err() {
                        break;
                    }
                }
                Err(err) => warn!("Bad command {line:?}: {err}"),
            }
        }
        // The app closed our stdin (or died): leave the lobby and exit.
        let _ = cmd_tx.send(Command::Shutdown);
    });

    let (list_tx, list_rx) = crossbeam_channel::unbounded();
    let mut bridge = Bridge {
        client,
        out,
        session: None,
        list_queue: VecDeque::new(),
        list_in_flight: None,
        list_tx,
        list_rx,
    };
    let mut last_flush = Instant::now();
    'main: loop {
        single.run_callbacks();
        loop {
            match cmd_rx.try_recv() {
                Ok(Command::Shutdown) | Err(TryRecvError::Disconnected) => break 'main,
                Ok(cmd) => bridge.handle(cmd),
                Err(TryRecvError::Empty) => break,
            }
        }
        bridge.poll();
        if last_flush.elapsed() >= TICK {
            bridge.flush();
            last_flush = Instant::now();
        }
        thread::sleep(TICK);
    }

    info!("Shutting down");
    // Dropping the session closes connections (with linger) and leaves the lobby.
    bridge.session = None;
    // Give Steam a moment to push out the lobby leave and lingering data.
    for _ in 0..50 {
        single.run_callbacks();
        thread::sleep(Duration::from_millis(10));
    }
}

type LobbyListResult = Result<Vec<protocol::LobbyInfo>, String>;

struct Bridge {
    client: steamworks::Client,
    out: Out,
    session: Option<Session>,
    /// Steam cancels an in-flight RequestLobbyList when another one is made,
    /// so requests are queued and run one at a time.
    list_queue: VecDeque<(u64, BTreeMap<String, String>)>,
    list_in_flight: Option<u64>,
    list_tx: crossbeam_channel::Sender<LobbyListResult>,
    list_rx: crossbeam_channel::Receiver<LobbyListResult>,
}

impl Bridge {
    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::CreateLobby {
                lobby_type,
                max_members,
                data,
            } => {
                // Leave any previous lobby first.
                self.session = None;
                let lobby_type = match lobby_type {
                    LobbyVisibility::Public => LobbyType::Public,
                    LobbyVisibility::FriendsOnly => LobbyType::FriendsOnly,
                    LobbyVisibility::Private => LobbyType::Private,
                };
                self.session = Some(Session::new_host(
                    self.client.clone(),
                    lobby_type,
                    max_members,
                    data,
                ));
            }
            Command::JoinLobby { lobby } => {
                self.session = None;
                match lobby_code::parse(&lobby) {
                    Some(id) => {
                        self.session = Some(Session::new_connect(id, self.client.clone()));
                    }
                    None => self.out.emit(&Event::LobbyJoinFailed {
                        reason: format!("\"{lobby}\" is not a valid lobby code."),
                    }),
                }
            }
            Command::LeaveLobby => {
                self.session = None;
            }
            Command::SetLobbyData { data } => {
                if let Some(session) = &self.session {
                    session.set_lobby_data(&data);
                }
            }
            Command::ListLobbies { req, filter } => {
                self.list_queue.push_back((req, filter));
                self.start_next_list();
            }
            Command::Send { to, data, reliable } => {
                let Some(session) = &mut self.session else {
                    return;
                };
                let Ok(to) = to.parse::<u64>() else {
                    warn!("Bad steam id {to:?}");
                    return;
                };
                let data = match base64::engine::general_purpose::STANDARD.decode(data) {
                    Ok(data) => data,
                    Err(err) => {
                        warn!("Bad base64 payload: {err}");
                        return;
                    }
                };
                let reliability = if reliable {
                    Reliability::Reliable
                } else {
                    Reliability::Unreliable
                };
                if let Err(err) = session.send_message(SteamId::from_raw(to), &data, reliability) {
                    warn!("Couldn't send a message to {to}: {err}");
                }
            }
            Command::Shutdown => {}
        }
    }

    fn start_next_list(&mut self) {
        if self.list_in_flight.is_some() {
            return;
        }
        if let Some((req, filter)) = self.list_queue.pop_front() {
            self.list_in_flight = Some(req);
            self.list_lobbies(filter);
        }
    }

    fn poll_lists(&mut self) {
        while let Ok(result) = self.list_rx.try_recv() {
            let Some(req) = self.list_in_flight.take() else {
                continue;
            };
            match result {
                Ok(lobbies) => self.out.emit(&Event::LobbyList { req, lobbies }),
                Err(reason) => self.out.emit(&Event::LobbyListFailed { req, reason }),
            }
            self.start_next_list();
        }
    }

    fn list_lobbies(&self, filter: BTreeMap<String, String>) {
        let matchmaking = self.client.matchmaking();
        // steamworks-rs passes these strings straight to the C API without adding a
        // terminator, so append the NUL ourselves. Steam copies the filters on call.
        let filter: Vec<(String, String)> = filter
            .into_iter()
            .map(|(k, v)| (format!("{k}\0"), format!("{v}\0")))
            .collect();
        for (key, value) in &filter {
            match LobbyKey::try_new(key) {
                Ok(key) => {
                    matchmaking.add_request_lobby_list_string_filter(StringFilter(
                        key,
                        value,
                        StringFilterKind::Include,
                    ));
                }
                Err(err) => warn!("Skipping lobby filter {key:?}: {err}"),
            }
        }
        matchmaking.set_request_lobby_list_distance_filter(DistanceFilter::Worldwide);
        matchmaking.set_request_lobby_list_result_count_filter(200);
        let client = self.client.clone();
        let tx = self.list_tx.clone();
        matchmaking.request_lobby_list(move |res| {
            let result = res
                .map(|ids| {
                    let matchmaking = client.matchmaking();
                    ids.into_iter()
                        .map(|id| steam_networking::lobby_info(&matchmaking, id))
                        .collect()
                })
                .map_err(|err| err.to_string());
            tx.send(result).ok();
        });
    }

    fn poll(&mut self) {
        self.poll_lists();
        let Some(session) = &mut self.session else {
            return;
        };
        let events = session.recv();
        let mut failed = false;
        for event in &events {
            if matches!(
                event,
                Event::LobbyCreateFailed { .. } | Event::LobbyJoinFailed { .. }
            ) {
                failed = true;
            }
            self.out.emit(event);
        }
        if failed {
            self.session = None;
        }
    }

    fn flush(&self) {
        if let Some(session) = &self.session {
            session.flush();
        }
    }
}
