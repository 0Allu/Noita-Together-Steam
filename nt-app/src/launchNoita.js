// Starts noita.exe for the player.
//
// The Steam helper signs in to Steam as Noita (app 881100), so while Noita Together
// is open Steam shows Noita as running and its Play button turns into Stop. Starting
// the exe ourselves, with the same Steam app id in the environment, gets around that
// (Entangled Worlds does the same).
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const { app, ipcMain } = require("electron")
const appEvent = require("./appEvent")

const NOITA_APP_ID = "881100"

let child = null

/** The game folder the mod updater found or the player picked (src/updater.js). */
function savedGameFolder() {
    try {
        const file = path.join(app.getPath("userData"), "gamePath.json")
        const folder = JSON.parse(fs.readFileSync(file, "utf-8"))
        return typeof folder === "string" ? folder.trim() : ""
    } catch (e) {
        return ""
    }
}

function report(state) {
    appEvent("noita_launch", state)
}

function launch() {
    if (child) {
        report({ status: "running" })
        return
    }
    if (process.platform !== "win32") {
        report({ status: "error", message: "Starting Noita from here only works on Windows for now. Start it from Steam instead." })
        return
    }
    const folder = savedGameFolder()
    const exe = folder && path.join(folder, "noita.exe")
    if (!exe || !fs.existsSync(exe)) {
        report({
            status: "error",
            message: "Couldn't find noita.exe. Restart Noita Together and pick your Noita folder when it asks."
        })
        return
    }

    let proc
    try {
        proc = spawn(exe, [], {
            cwd: folder,
            env: Object.assign({}, process.env, { SteamAppId: NOITA_APP_ID, SteamGameId: NOITA_APP_ID }),
            // Noita keeps running if Noita Together is closed
            detached: true,
            stdio: "ignore"
        })
    } catch (e) {
        report({ status: "error", message: `Couldn't start Noita: ${e.message}` })
        return
    }
    child = proc
    proc.on("error", (e) => {
        if (child === proc) child = null
        report({ status: "error", message: `Couldn't start Noita: ${e.message}` })
    })
    proc.on("exit", () => {
        if (child === proc) child = null
        report({ status: "stopped" })
    })
    proc.unref()
    report({ status: "running" })
}

ipcMain.on("launch_noita", launch)

module.exports = { launch }
