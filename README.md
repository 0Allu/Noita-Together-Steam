# Noita Together Steam

Play alone together, now over Steam.

[Download the latest release](../../releases/latest)

## About this fork

[Noita Together](https://github.com/Noita-Together/noita-together) was
archived after it went without a maintainer for a long time, and its servers
at noitatogether.com were shut down. Without those servers the original app
can't log in or create rooms.

This fork removes the need for any server. Rooms are Steam lobbies, and
players connect to each other through Steam's peer-to-peer networking, so
nobody has to run a server or open ports. The Steam networking code comes
from [Noita Entangled Worlds](https://github.com/IntQuant/noita_entangled_worlds)
(see [nt-steam-bridge](nt-steam-bridge)).

The in-game mod is still Noita Together, and it still installs as
`noita-together` in Noita's mods folder.

## What is Noita Together?

Noita Together adds a light multiplayer layer to Noita. Each player is in
their own world, but you can see the other players, chat, trade items through
a shared bank, and share things like perks, hearts, orbs and gold depending on
the room's settings. You can't directly affect another player's world.

It has two parts: a desktop app that handles rooms and talks to Steam, and a
Lua mod that talks to the app from inside the game. The mod uses
[pollws](https://github.com/probable-basilisk/pollws/) by probable-basilisk.

## Installing

1. Download `Noita-Together-Steam-Setup.exe` from the
   [releases page](../../releases/latest) and run it. The installer isn't
   signed, so Windows may warn you before it runs.
2. Start Steam and sign in with an account that owns Noita.
3. Open Noita Together. It finds your Noita folder (or asks for it) and
   installs the mod from its own copy, so nothing is downloaded.
4. In Noita, open Mods, enable unsafe mods, and turn on Noita Together.

Everyone in a room needs a compatible version of the app. Rooms from an
incompatible version don't show up in the list.

## Playing

- The app signs you in with the Steam account that's running. There's no
  Twitch login anymore.
- Whoever creates a room is its host. The host's app does everything the lobby
  server used to do: passwords, kicks and bans, ready checks, the item bank and
  run stats. The room runs in the host's app, so it closes when the host
  leaves.
- A room is either listed publicly or joinable only with an invite code. The
  code is shown at the top of the room; others paste it into the invite code
  field in the lobby. Accepting a Steam invite to the host's
  lobby should also work while the app is open, but that hasn't been tested.
- While the app is open, Steam thinks Noita is running (the app uses Noita's
  Steam app ID, like Entangled Worlds), so Steam's Play button turns into Stop.
  Start the game with the Start Noita button in the room instead. Pressing Stop
  in Steam closes the app.
- Run stats are posted in chat when the host ends the run, since the stats
  website is gone.

### Room options added in this fork

- Max players can be set to anything from 1 to 120, and the host can
  change it later by clicking the player count in the room.
- Shared random seed picks one random world for everyone and a new one
  after every run.
- Shared Gold gives the whole team one wallet. Send Gold is turned off
  while it's on.
- Shared health (ends run) is a death penalty: the team shares one health
  bar and max HP, and the run ends for everyone when anyone dies. Sync Hearts is
  turned off while it's on, because hearts already count for everyone.
- Banned perks lets the host ban any perk, in both co-op and Nemesis. The
  full perk list shows up after Noita has connected to the app for the first
  time.
- Game options are grouped into sections, and options that don't apply to the
  current settings are hidden.

## Building

Only Windows builds have been tested.

### Requirements

- [Node.js](https://nodejs.org). Version 16.20.0 is what the original project
  used. Newer versions work too (tested with Node 24), but webpack 4 then needs
  `NODE_OPTIONS=--openssl-legacy-provider` for the build commands.
- Yarn. Get a `yarn` command once with `corepack enable` (included with Node)
  or `npm install -g yarn`. Inside this repository it then runs the Yarn 3.5.1
  stored in `.yarn/releases`.
- A [Rust toolchain](https://rustup.rs) for the Steam helper. On Windows,
  rustup asks you to install the Visual Studio C++ build tools if you don't
  have them.
- Keep the repository in a short path, like `C:\dev\noita-together-steam`. The
  Rust build fails in deeply nested folders because of Windows' 260 character
  path limit.

### Commands

From the repository root:

```sh
yarn install
yarn buildSteam
```

`yarn buildSteam` builds the Steam helper and copies it, together with
`steam_api64.dll`, into `nt-app/resources/steam`. Run it again whenever you
change anything in `nt-steam-bridge`.

To run the app in development mode:

```sh
yarn client
```

To build the installer:

```sh
yarn buildClient
```

The installer ends up in `nt-app/dist_electron` as
`Noita-Together-Steam-Setup.exe`. The version number is in
`nt-app/package.json`.

With Node 17 or newer, set the OpenSSL option first. In PowerShell:

```powershell
$env:NODE_OPTIONS = "--openssl-legacy-provider"
yarn buildClient
```

In Git Bash:

```sh
NODE_OPTIONS=--openssl-legacy-provider yarn buildClient
```

### Releasing

The app checks this repository's latest GitHub release for updates when it
starts and every 4 hours. It downloads a newer version in the background and
installs it when the app closes, or right away from the "Restart now" button.

1. Raise `"version"` in `nt-app/package.json`. The app only updates to a higher
   version number.
2. Build the installer with `yarn buildClient`.
3. Create a GitHub release with a tag matching the version, like `v0.12.1`, and
   upload these three files from `nt-app/dist_electron`:
   - `Noita-Together-Steam-Setup.exe`
   - `Noita-Together-Steam-Setup.exe.blockmap`
   - `latest.yml`

Without `latest.yml` on the latest release, installed apps can't see the
update.

### Testing with Spacewar

Set `NT_STEAM_APPID=480` to run the Steam helper as Spacewar, Valve's free test
app, instead of Noita. Lobbies created that way are only visible to other
copies running as Spacewar. See [nt-steam-bridge](nt-steam-bridge/README.md)
for the other settings.

### The mod

The mod lives in `noita_mod`: the core mod in `noita_mod/core` and Nemesis in
`noita_mod/nemesis`. The app bundles it and installs it into Noita's mods
folder when it starts.

After changing the mod, update its manifests:

```sh
node ./build-mods.js
```

Then commit `noita_mod/core/manifest.json` and
`noita_mod/nemesis/manifest.json` along with your changes.

### Repository layout

- `noita_mod`: the Noita mod
- `nt-app`: the desktop app (Electron and Vue)
- `nt-steam-bridge`: the Steam helper (Rust)
- `nt-web-app` (the old website and auth server) and `shared-lib`: left over
  from the server version. The Steam version doesn't use them.

## Credits

- Noita Together was created by [Soler91](https://github.com/soler91) and later
  maintained by [SkyeOfBreeze](https://github.com/SkyeOfBreeze) and the other
  contributors to the
  [original repository](https://github.com/Noita-Together/noita-together).
- The Steam networking is ported from
  [Noita Entangled Worlds](https://github.com/IntQuant/noita_entangled_worlds),
  licensed MIT or Apache-2.0 (see `nt-steam-bridge/LICENSE-MIT` and
  `nt-steam-bridge/LICENSE-APACHE`).
- [pollws](https://github.com/probable-basilisk/pollws/) by probable-basilisk.

Noita Together is MIT licensed; see [LICENSE](LICENSE).
