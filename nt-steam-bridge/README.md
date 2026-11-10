# nt-steam-bridge

A small helper program that gives the Noita Together app Steam lobbies and
Steam P2P networking. The Electron app (`nt-app/src/steam/bridge.js`) starts it
as a child process and talks to it over stdin/stdout.

The networking code is ported from
[Noita Entangled Worlds](https://github.com/IntQuant/noita_entangled_worlds)
(`noita_proxy/src/net/steam_networking.rs` and `lobby_code.rs`), which is
licensed MIT OR Apache-2.0; see `LICENSE-MIT` and `LICENSE-APACHE` in this
folder. This crate is offered under the same terms.

## Building

Needs a Rust toolchain (<https://rustup.rs>). From the repository root:

```sh
yarn buildSteam
```

That runs `nt-app/scripts/build-steam-bridge.js`, which builds this crate in
release mode and copies the executable and the Steam API library
(`steam_api64.dll` / `libsteam_api.so` / `libsteam_api.dylib`, shipped inside
the `steamworks-sys` crate) to `nt-app/resources/steam/`. electron-builder
packages that folder as `resources/steam`.

## Runtime

- Steam must be running and the logged-in account must own Noita: the bridge
  initialises the Steam API as Noita (app id 881100), the same way Entangled
  Worlds does.
- `NT_STEAM_APPID` overrides the app id (e.g. `480` for testing with Spacewar).
- `NT_STEAM_LOG` sets the log filter (`tracing` syntax, default `info`). Logs go
  to stderr, which the app prints with a `[steam]` prefix.
- `NT_STEAM_BRIDGE` (read by the app) points at a bridge executable to use
  instead of the bundled one.

## Protocol

One JSON object per line in each direction. Steam IDs and lobby IDs are decimal
strings because they don't fit in a JavaScript number. Message payloads are
base64.

Commands (app → bridge, field `cmd`):

| cmd | fields | reply |
| --- | --- | --- |
| `create_lobby` | `lobby_type` (`public` / `friends_only` / `private`), `max_members`, `data` (metadata) | `lobby_created` or `lobby_create_failed` |
| `join_lobby` | `lobby` (invite code or lobby id) | `lobby_joined` or `lobby_join_failed` |
| `leave_lobby` | | |
| `set_lobby_data` | `data` (only works for the lobby owner) | |
| `list_lobbies` | `req` (request id), `filter` (exact-match metadata) | `lobby_list` or `lobby_list_failed` with the same `req` |
| `send` | `to`, `data`, `reliable` (default `true`) | |
| `shutdown` | | process exits |

Events (bridge → app, field `ev`): `ready`, `init_failed`, `lobby_created`,
`lobby_create_failed`, `lobby_joined`, `lobby_join_failed`, `peer_joined`,
`peer_left`, `peer_connected`, `send_stuck`, `message`, `lobby_list`,
`lobby_list_failed`, `join_requested` (the user accepted a Steam invite or
clicked "Join game"). See `src/protocol.rs` for the exact fields.

Closing stdin is treated like `shutdown`.

## Topology

Noita Together's room logic (what the lobby server used to do) runs inside the
host's app, so the bridge uses a star: the lobby owner connects to every member
and members only connect to the owner. Connections use
`ISteamNetworkingSockets` P2P with Steam's relay network, so nobody needs to
open ports.

Invite codes look like `n0s1a2b3ct`: the lobby id, minus a constant, in hex.
Plain lobby ids are accepted too.
