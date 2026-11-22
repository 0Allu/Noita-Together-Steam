const { execFile } = require("child_process")

// Whether the app downloads and installs updates on its own. The installer
// writes it (installer/installer.nsh) and the app's footer toggle changes it, so it
// lives in the registry rather than in the install folder, which every update
// replaces. Both sides use the 64-bit view of HKLM. The app runs as admin
// (requestedExecutionLevel in vue.config.js), so it can write there.
const KEY = "HKLM\\Software\\Noita Together Steam"
const VALUE = "AutoUpdate"

function reg(args) {
    return new Promise((resolve) => {
        execFile("reg.exe", args.concat("/reg:64"), { windowsHide: true }, (err, stdout) => {
            resolve({ err, stdout: String(stdout || "") })
        })
    })
}

// on unless the value says 0: a missing key means an install from before this
// setting existed, and those always updated themselves
async function getAutoUpdate() {
    if (process.platform !== "win32") return true
    const { err, stdout } = await reg(["query", KEY, "/v", VALUE])
    if (err) return true
    const m = /AutoUpdate\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout)
    return !m || parseInt(m[1], 16) !== 0
}

async function setAutoUpdate(on) {
    if (process.platform !== "win32") return
    const { err } = await reg(["add", KEY, "/v", VALUE, "/t", "REG_DWORD", "/d", on ? "1" : "0", "/f"])
    if (err) throw err
}

module.exports = { getAutoUpdate, setAutoUpdate }
