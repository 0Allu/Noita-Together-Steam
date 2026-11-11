"use strict"
const NT_SCHEME = "noitatogether"
const path = require("path")
const fs = require("fs")
import { autoUpdater } from "electron-updater"
import { app, protocol, BrowserWindow, ipcMain } from "electron"
import { createProtocol } from "vue-cli-plugin-electron-builder/lib"
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer"
import { updateMod } from "./update.js"
const appEvent = require("./appEvent")
const wsClient = require("./ws.js")
const cmdLineArgs = require("./cmdLineArgs")
const steamBridge = require("./steam/bridge")
// "Start Noita" button (Steam won't start Noita while we're signed in as it)
require("./launchNoita")
const isDevelopment = process.env.NODE_ENV !== "production"
const primaryInstance = app.requestSingleInstanceLock()
let mainWindow = null
// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { secure: true, standard: true } }
])
/*
if (isDevelopment && process.platform === 'win32') {
    app.removeAsDefaultProtocolClient(NT_SCHEME)
    app.setAsDefaultProtocolClient(NT_SCHEME, process.execPath, [path.resolve(process.argv[1])])
} else {
    if (!app.isDefaultProtocolClient(NT_SCHEME)) {
        app.setAsDefaultProtocolClient(NT_SCHEME)
    }
}
*/
// Auto-update from the latest GitHub release (needs latest.yml, the installer and its
// .blockmap uploaded to the release). Updates download in the background and install
// when the app closes, or right away from the banner's "Restart now" button.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.disableWebInstaller = true
autoUpdater.logger = { info: () => {}, warn: (m) => console.log(`[updater] ${m}`), error: (m) => console.log(`[updater] ${m}`) }
autoUpdater.on("error", (err) => {
    // offline, GitHub down, or a release without latest.yml: try again later
    console.log(`[updater] ${err && err.message}`)
})
autoUpdater.on("update-downloaded", (info) => {
    appEvent("UPDATE_DOWNLOADED", { version: info && info.version })
})
ipcMain.on("install_update", () => {
    // silent install, then start the new version
    autoUpdater.quitAndInstall(true, true)
})

function checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => console.log(`[updater] ${err && err.message}`))
}

function startUpdateChecks() {
    if (isDevelopment) return
    checkForUpdates()
    setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

async function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        title: "Noita Together",
        transparent: false,
        frame: false,
        thickFrame: true,
        width: 800,
        minWidth: 400,
        height: 700,
        minHeight: 600,
        backgroundColor: "#2e2c29",
        resizable: true,
        webPreferences: {
            // Use pluginOptions.nodeIntegration, leave this alone
            // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
            nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
            enableRemoteModule: true
        }
    })

    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
        if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
    } else {
        createProtocol("app")
        /*
        protocol.registerHttpProtocol(NT_SCHEME, (req, cb) => {
            dialog.showErrorBox(`NT: ${req.url}`)
        })
        */
        // Load the index.html when not in development
        mainWindow.loadURL("app://./index.html")
        startUpdateChecks()
    }
}

ipcMain.on("update_mod", (event, gamePath) => {
    if (cmdLineArgs.isNoUpdate()) {
        appEvent("skip_update", true)
        return
    }

    if (gamePath) {
        const userDataPath = path.join(
            app.getPath("userData"),
            "/gamePath.json"
        )
        fs.writeFileSync(userDataPath, JSON.stringify(gamePath))
    }
    updateMod(gamePath)
})

// Twitch login and the noitatogether.com servers are gone; your identity is
// your Steam account, and rooms are Steam lobbies.
ipcMain.on("STEAM_LOGIN", async () => {
    try {
        const me = await steamBridge.start()
        // allows naming rooms (the server reserved that for some accounts)
        appEvent("USER_EXTRA", 1)
        wsClient({
            display_name: me.name,
            id: me.steamId
        })
    } catch (error) {
        console.error(error)
        appEvent("STEAM_LOGIN_FAILED", { reason: error.message })
    }
})

// The helper runs as Noita (app 881100), so pressing Stop on Noita in Steam, or
// quitting Steam, ends it. Nothing works without it, so close the app too
// instead of leaving a "Disconnected from Steam" dialog behind.
steamBridge.on("exit", ({ code, signal }) => {
    console.log(`[steam] helper stopped (code=${code} signal=${signal}), quitting`)
    app.quit()
})

app.on("will-quit", () => {
    // closing the bridge leaves any Steam lobby we're in
    steamBridge.stop()
})

// Quit when all windows are closed.
app.on("window-all-closed", () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
        app.quit()
    }
})

app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

if (!primaryInstance) {
    app.quit()
} else {
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.focus()
        }
    })

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on("ready", async () => {
        if (isDevelopment && !process.env.IS_TEST) {
            // Install Vue Devtools
            try {
                await installExtension(VUEJS_DEVTOOLS)
            } catch (e) {
                console.error("Vue Devtools failed to install:", e.toString())
            }
        }
        createWindow()
    })
}

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === "win32") {
        process.on("message", (data) => {
            if (data === "graceful-exit") {
                app.quit()
            }
        })
    } else {
        process.on("SIGTERM", () => {
            app.quit()
        })
    }
}
