// Builds nt-steam-bridge (../../nt-steam-bridge) and copies it, together with
// the Steam API library it loads, into nt-app/resources/steam. electron-builder
// ships that folder as <resources>/steam (see vue.config.js), and
// src/steam/bridge.js looks for it there.
//
// Requires a Rust toolchain (https://rustup.rs).
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const manifest = path.resolve(__dirname, "..", "..", "nt-steam-bridge", "Cargo.toml")
const outDir = path.resolve(__dirname, "..", "resources", "steam")

const libs = {
    win32: ["win64", "steam_api64.dll"],
    linux: ["linux64", "libsteam_api.so"],
    darwin: ["osx", "libsteam_api.dylib"]
}
const lib = libs[process.platform]
if (!lib) {
    console.error(`Unsupported platform ${process.platform}`)
    process.exit(1)
}
const exe = process.platform === "win32" ? "nt-steam-bridge.exe" : "nt-steam-bridge"

execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", manifest], { stdio: "inherit" })

const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
    })
)
const steamworksSys = meta.packages.find((p) => p.name === "steamworks-sys")
const redist = path.join(path.dirname(steamworksSys.manifest_path), "lib", "steam", "redistributable_bin")

fs.mkdirSync(outDir, { recursive: true })
for (const [from, to] of [
    [path.join(meta.target_directory, "release", exe), path.join(outDir, exe)],
    [path.join(redist, lib[0], lib[1]), path.join(outDir, lib[1])]
]) {
    fs.copyFileSync(from, to)
    console.log(`copied ${from} -> ${to}`)
}
