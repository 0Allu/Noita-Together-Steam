//! JSON-lines protocol spoken between the Noita Together app and this bridge.
//!
//! The app writes one `Command` per line to our stdin, we write one `Event`
//! per line to stdout. Binary payloads are base64. Steam ids and lobby ids are
//! sent as decimal strings because they don't fit in a JS number.

use std::{
    collections::BTreeMap,
    io::Write,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum LobbyVisibility {
    #[default]
    Public,
    FriendsOnly,
    Private,
}

fn default_max_members() -> u32 {
    250
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    /// Create a lobby and become its host.
    CreateLobby {
        #[serde(default)]
        lobby_type: LobbyVisibility,
        #[serde(default = "default_max_members")]
        max_members: u32,
        #[serde(default)]
        data: BTreeMap<String, String>,
    },
    /// Join a lobby by lobby code or raw lobby id.
    JoinLobby { lobby: String },
    /// Leave the current lobby (if any) and close all peer connections.
    LeaveLobby,
    /// Host only: set lobby metadata visible in the lobby list.
    SetLobbyData { data: BTreeMap<String, String> },
    /// Request the lobby list. Every `filter` entry must match exactly.
    ListLobbies {
        req: u64,
        #[serde(default)]
        filter: BTreeMap<String, String>,
    },
    /// Send a message to a peer in the current lobby.
    Send {
        to: String,
        data: String,
        #[serde(default = "default_true")]
        reliable: bool,
    },
    Shutdown,
}

#[derive(Debug, Serialize, Clone)]
pub struct LobbyInfo {
    pub lobby_id: String,
    pub code: String,
    pub members: usize,
    pub max_members: usize,
    pub data: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    Ready {
        steam_id: String,
        name: String,
        app_id: u32,
    },
    InitFailed {
        reason: String,
    },
    LobbyCreated {
        lobby_id: String,
        code: String,
    },
    LobbyCreateFailed {
        reason: String,
    },
    LobbyJoined {
        lobby_id: String,
        code: String,
        owner_id: String,
        data: BTreeMap<String, String>,
    },
    LobbyJoinFailed {
        reason: String,
    },
    /// Someone entered the lobby we're in.
    PeerJoined {
        steam_id: String,
        name: String,
    },
    /// Someone left the lobby we're in (or dropped from Steam).
    PeerLeft {
        steam_id: String,
    },
    /// A P2P connection to this peer is established; messages can flow.
    PeerConnected {
        steam_id: String,
        name: String,
    },
    /// Reliable messages to this peer have been stuck for too long.
    SendStuck {
        steam_id: String,
    },
    Message {
        from: String,
        data: String,
    },
    LobbyList {
        req: u64,
        lobbies: Vec<LobbyInfo>,
    },
    LobbyListFailed {
        req: u64,
        reason: String,
    },
    /// The user accepted a Steam invite / clicked "Join game" on a friend.
    JoinRequested {
        lobby_id: String,
        code: String,
    },
}

/// Serialized writer for stdout. Every event is one line.
#[derive(Clone)]
pub struct Out(Arc<Mutex<std::io::Stdout>>);

impl Out {
    pub fn new() -> Self {
        Out(Arc::new(Mutex::new(std::io::stdout())))
    }

    pub fn emit(&self, event: &Event) {
        let line = match serde_json::to_string(event) {
            Ok(line) => line,
            Err(err) => {
                tracing::error!("Could not serialize event: {err}");
                return;
            }
        };
        let mut out = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // A broken pipe means the app is gone; the stdin thread will notice and shut us down.
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}
