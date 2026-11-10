//! Short, copy-pasteable lobby codes.
//!
//! Ported from Noita Entangled Worlds (`noita_proxy/src/lobby_code.rs`, MIT OR Apache-2.0).
//! Uses a different prefix/suffix (`n`...`t`) so that Noita Together and
//! Entangled Worlds codes can't be confused with each other.

use steamworks::LobbyId;

const VERSION: char = '0';
/// Steam lobby ids all share this high part; subtracting it keeps codes short.
const BASE: u64 = 0x0186000000000000;

pub fn serialize(lobby: LobbyId) -> String {
    format!("n{}s{:x}t", VERSION, lobby.raw().wrapping_sub(BASE))
}

/// Accepts either a lobby code (`n0s...t`) or a raw decimal lobby id.
pub fn parse(raw: &str) -> Option<LobbyId> {
    let raw = raw.trim();
    if let Ok(id) = raw.parse::<u64>() {
        return Some(LobbyId::from_raw(id));
    }
    if !(raw.starts_with('n') && raw.ends_with('t')) || raw.len() < 5 {
        return None;
    }
    let mut chars = raw.chars();
    chars.next();
    if chars.next()? != VERSION || chars.next()? != 's' {
        return None;
    }
    let hex = &raw[3..raw.len() - 1];
    let code = u64::from_str_radix(hex, 16).ok()?;
    Some(LobbyId::from_raw(code.wrapping_add(BASE)))
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn roundtrip() {
        let id = LobbyId::from_raw(109775241234567890);
        let code = serialize(id);
        assert!(code.starts_with("n0s") && code.ends_with('t'));
        assert_eq!(parse(&code), Some(id));
        assert_eq!(parse("109775241234567890"), Some(id));
        assert_eq!(parse("e0s123w"), None);
        assert_eq!(parse("garbage"), None);
    }
}
