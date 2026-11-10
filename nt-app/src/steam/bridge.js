// Talks to nt-steam-bridge (see /nt-steam-bridge), a small helper process that
// gives us Steam lobbies and Steam P2P networking. One JSON object per line in
// each direction; ids are strings because SteamIDs don't fit in a JS number.
const { spawn } = require("child_process")
const EventEmitter = require("events")
const fs = require("fs")
const path = require("path")
const readline = require("readline")

const EXE = process.platform === "win32" ? "nt-steam-bridge.exe" : "nt-steam-bridge"

function findBridge() {
    const candidates = []
    if (process.env.NT_STEAM_BRIDGE) candidates.push(process.env.NT_STEAM_BRIDGE)
    // packaged app: electron-builder copies resources/steam to <resources>/steam
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "steam", EXE))
    // `yarn electron:serve` runs from nt-app/
    candidates.push(path.resolve(process.cwd(), "resources", "steam", EXE))
    candidates.push(path.resolve(process.cwd(), "nt-app", "resources", "steam", EXE))
    return candidates.find((p) => {
        try {
            return fs.statSync(p).isFile()
        } catch (e) {
            return false
        }
    })
}

class SteamBridge extends EventEmitter {
    constructor() {
        super()
        this.setMaxListeners(0)
        this.proc = null
        this.starting = null
        this.me = null
        this.reqId = 0
    }

    /**
     * Start the bridge (once) and resolve with the local Steam user.
     * @returns {Promise<{steamId: string, name: string}>}
     */
    start() {
        if (this.starting) return this.starting
        this.starting = new Promise((resolve, reject) => {
            const exe = findBridge()
            if (!exe) {
                this.starting = null
                reject(new Error(`Could not find ${EXE}. Run "yarn build:steam" or reinstall the app.`))
                return
            }
            console.log(`[steam] starting ${exe}`)
            let settled = false
            // the Steam API library sits next to the executable
            const env = Object.assign({}, process.env)
            const libVar = { linux: "LD_LIBRARY_PATH", darwin: "DYLD_LIBRARY_PATH" }[process.platform]
            if (libVar) env[libVar] = [path.dirname(exe), env[libVar]].filter(Boolean).join(path.delimiter)
            const proc = spawn(exe, [], {
                cwd: path.dirname(exe),
                env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true
            })
            this.proc = proc

            readline.createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line))
            readline.createInterface({ input: proc.stderr }).on("line", (line) => console.log(`[steam] ${line}`))

            const onReady = (ev) => {
                settled = true
                this.removeListener("init_failed", onFailed)
                this.me = { steamId: ev.steam_id, name: ev.name }
                resolve(this.me)
            }
            const onFailed = (ev) => {
                settled = true
                this.removeListener("ready", onReady)
                reject(new Error(ev.reason))
            }
            this.once("ready", onReady)
            this.once("init_failed", onFailed)

            proc.stdin.on("error", (err) => console.log(`[steam] stdin error: ${err.message}`))
            proc.on("error", (err) => {
                if (!settled) {
                    settled = true
                    this.starting = null
                    reject(err)
                }
            })
            proc.on("exit", (code, signal) => {
                console.log(`[steam] bridge exited code=${code} signal=${signal}`)
                this.proc = null
                this.starting = null
                if (!settled) {
                    settled = true
                    this.removeListener("ready", onReady)
                    reject(new Error(`Steam bridge exited (code ${code})`))
                    return
                }
                if (this.me) this.emit("exit", { code, signal })
                this.me = null
            })
        })
        return this.starting
    }

    onLine(line) {
        // steam_api occasionally prints diagnostics on stdout; only JSON lines are ours
        if (!line.startsWith("{")) {
            console.log(`[steam] ${line}`)
            return
        }
        let ev
        try {
            ev = JSON.parse(line)
        } catch (e) {
            console.log(`[steam] unparseable line: ${line}`)
            return
        }
        this.emit(ev.ev, ev)
    }

    command(obj) {
        if (!this.proc) return false
        this.proc.stdin.write(JSON.stringify(obj) + "\n")
        return true
    }

    /** Resolve on `okEvent`, reject on `errEvent`, bridge exit, or timeout. */
    request(cmd, okEvent, errEvent, timeoutMs) {
        return new Promise((resolve, reject) => {
            let timer = null
            const cleanup = () => {
                clearTimeout(timer)
                this.removeListener(okEvent, onOk)
                this.removeListener(errEvent, onErr)
                this.removeListener("exit", onExit)
            }
            const onOk = (ev) => {
                cleanup()
                resolve(ev)
            }
            const onErr = (ev) => {
                cleanup()
                reject(new Error(ev.reason))
            }
            const onExit = () => {
                cleanup()
                reject(new Error("Lost connection to Steam."))
            }
            this.on(okEvent, onOk)
            this.on(errEvent, onErr)
            this.on("exit", onExit)
            timer = setTimeout(() => {
                cleanup()
                reject(new Error("Timed out waiting for Steam."))
            }, timeoutMs)
            if (!this.command(cmd)) {
                cleanup()
                reject(new Error("Steam is not running."))
            }
        })
    }

    /**
     * @param {{lobbyType: 'public'|'friends_only'|'private', maxMembers: number, data: Record<string,string>}} opts
     * @returns {Promise<{lobby_id: string, code: string}>}
     */
    createLobby({ lobbyType, maxMembers, data }) {
        return this.request(
            { cmd: "create_lobby", lobby_type: lobbyType, max_members: maxMembers, data: stringify(data) },
            "lobby_created",
            "lobby_create_failed",
            30000
        )
    }

    /**
     * @param {string} lobby lobby code or raw lobby id
     * @returns {Promise<{lobby_id: string, code: string, owner_id: string, data: Record<string,string>}>}
     */
    joinLobby(lobby) {
        return this.request({ cmd: "join_lobby", lobby: String(lobby) }, "lobby_joined", "lobby_join_failed", 30000)
    }

    leaveLobby() {
        this.command({ cmd: "leave_lobby" })
    }

    setLobbyData(data) {
        this.command({ cmd: "set_lobby_data", data: stringify(data) })
    }

    /**
     * @param {Record<string,string>} filter exact-match lobby metadata filters
     * @returns {Promise<Array<{lobby_id: string, code: string, members: number, max_members: number, data: Record<string,string>}>>}
     */
    listLobbies(filter) {
        const req = ++this.reqId
        return new Promise((resolve, reject) => {
            let timer = null
            const cleanup = () => {
                clearTimeout(timer)
                this.removeListener("lobby_list", onList)
                this.removeListener("lobby_list_failed", onFail)
            }
            const onList = (ev) => {
                if (ev.req !== req) return
                cleanup()
                resolve(ev.lobbies)
            }
            const onFail = (ev) => {
                if (ev.req !== req) return
                cleanup()
                reject(new Error(ev.reason))
            }
            this.on("lobby_list", onList)
            this.on("lobby_list_failed", onFail)
            timer = setTimeout(() => {
                cleanup()
                reject(new Error("Timed out waiting for the Steam lobby list."))
            }, 20000)
            if (!this.command({ cmd: "list_lobbies", req, filter: stringify(filter) })) {
                cleanup()
                reject(new Error("Steam is not running."))
            }
        })
    }

    /**
     * @param {string} steamId
     * @param {Uint8Array} buf
     */
    sendTo(steamId, buf, reliable = true) {
        const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("base64")
        this.command({ cmd: "send", to: steamId, data, reliable })
    }

    stop() {
        if (!this.proc) return
        this.command({ cmd: "shutdown" })
        this.proc.stdin.end()
    }
}

function stringify(obj) {
    const out = {}
    for (const key of Object.keys(obj || {})) {
        const val = obj[key]
        if (val === undefined || val === null) continue
        out[key] = typeof val === "boolean" ? (val ? "1" : "0") : String(val)
    }
    return out
}

module.exports = new SteamBridge()
