const EventEmitter = require("events")
const http = require("http")
const path = require("path")
const ws = require("ws")
const { v4: uuidv4 } = require("uuid")
const appEvent = require("./appEvent")
const cmdLineArgs = require("./cmdLineArgs")
const { ipcMain } = require("electron")
const { NT } = require("@noita-together/nt-message")
const { decodeFrames } = require("./frameCoder")
const { gameData } = require("./steam/dataFilter")
const { writeRoomSeed, loadoutShift } = require("./roomSeed")
function sysMsg(message) {
    appEvent("sChat", {
        id: uuidv4(),
        userId: "-1",
        name: "[SYSTEM]",
        message
    })
}

function lerp(a, b, weight) {
    return a * weight + b * (1 - weight)
}

function rotLerp(a, b, weight) {
    const pi2 = Math.PI * 2
    const shortest = ((a - b + Math.PI) % pi2) - Math.PI
    return b + ((shortest * weight) % pi2)
}

const distSquaredThreshold = 400 * 400

// Events the game socket must never trigger: EventEmitter's own ("error" with no
// listener throws in the main process) and the ones this class emits itself.
const RESERVED_GAME_EVENTS = new Set(["error", "newListener", "removeListener", "GAME_OPEN", "GAME_CLOSE"])

class NoitaGame extends EventEmitter {
    constructor() {
        super()
        this.setMaxListeners(0)
        this.port = 25569
        this.server = null

        this.client = null
        this.paused = false
        this.queue = []
        this.queueDelay = 5000

        this.rejectConnections = true
        this.user = { userId: 0, name: "", host: false }
        this.spellList = []
        this.gameFlags = []
        this.players = {}
        this.bank = {
            wands: [],
            spells: [],
            flasks: [],
            objects: [],
            gold: 0
        }
        this.onDeathKick = false
        this.lastX = 0
        this.lastY = 0
        // no room yet: forget the seed from an earlier session. Not in gameListen: the
        // room view starts that after the room exists and its seed is already written.
        writeRoomSeed(0)
        ipcMain.once("game_listen", () => {
            this.gameListen()
        })
    }

    setLastPosition(x, y) {
        if (typeof x === "number" && typeof y === "number") {
            this.lastX = x
            this.lastY = y
        }
    }

    isConnectionLocalhost(ws) {
        const addr = ws._socket.remoteAddress
        return (
            addr == "::1" ||
            addr == "127.0.0.1" ||
            addr == "localhost" ||
            addr == "::ffff:127.0.0.1" ||
            cmdLineArgs.isAllowRemoteNoita()
        )
    }

    clientDisconnected(){
        console.log('client disconnected')
        this.sendEvt('ClientDisconnected')
    }

    /**
     * Browsers send an Origin header with every websocket handshake; Noita's websocket
     * library (pollnet / tungstenite) never does. Rejecting it stops web pages open in
     * the user's browser from connecting to ws://localhost.
     */
    isBrowserRequest(req) {
        return req.headers.origin !== undefined
    }

    gameListen() {
        if (!this.server) {
            this.server = new ws.Server({ noServer: true })
            // The game connects to "localhost", which can be 127.0.0.1 or ::1, so listen on
            // both loopback addresses and nothing else (unless remote Noita is allowed).
            const hosts = cmdLineArgs.isAllowRemoteNoita() ? [undefined] : ["127.0.0.1", "::1"]
            for (const host of hosts) {
                const httpServer = http.createServer((req, res) => {
                    res.writeHead(426)
                    res.end()
                })
                httpServer.on("upgrade", (req, sock, head) => {
                    if (this.isBrowserRequest(req)) {
                        sock.end("HTTP/1.1 403 Forbidden\r\n\r\n")
                        return
                    }
                    this.server.handleUpgrade(req, sock, head, (socket) => {
                        this.server.emit("connection", socket, req)
                    })
                })
                httpServer.on("error", (err) => {
                    // e.g. no IPv6 on this machine; the other address still works
                    console.log(`[Game WS] can't listen on ${host || "all addresses"}:${this.port}: ${err.message}`)
                })
                httpServer.listen(this.port, host)
            }
        }
        this.server.on("connection", (socket) => {
            //console.log("[Game WS] New connection(?)")
            if (!this.isConnectionLocalhost(socket) || this.rejectConnections) {
                //console.log("terminate")
                socket.terminate()
                return
            }

            socket.on("message", (data) => {
                this.gameMessage(data, socket)
            })

            socket.on("close", () => {
                if (this.client === socket) {
                    //console.log("[Game] Disconnected.")
                    this.client = null
                    this.emit("GAME_CLOSE")
                }
            })
        })

        this.on("GameSpellList", (payload) => {
            this.setSpellList(payload)
        })
        // for the perk ban picker in Game Options
        this.on("GamePerkList", (payload) => {
            if (payload && Array.isArray(payload.perks)) {
                appEvent("GamePerkList", payload.perks)
                gameData.setPerks(payload.perks.map((p) => p && p.id).filter(Boolean))
            }
        })
        this.on("RequestPlayerList", () => {
            this.sendPlayerList()
            this.sendEvt("UpdateFlags", this.gameFlags)
        })
        this.on("PlayerDeath", () => {
            this.bank = {
                wands: [],
                spells: [],
                flasks: [],
                objects: [],
                gold: 0
            }
        })
        this.on("RunOver", () => {
            this.bank = {
                wands: [],
                spells: [],
                flasks: [],
                objects: [],
                gold: 0
            }
        })
    }
    // event and ping
    // {event: "", payload: {}}
    gameMessage(data, socket) {
        // only one game connection at a time: the first socket to talk claims it, and
        // nothing else can inject events while it's open
        if (this.client && socket !== this.client) return
        let dataJSON = null
        if (data.slice(0, 1) == ">") {
            if (data == ">RES> [no value]") {
                return
            } else {
                //console.log(data)
                return
            }
        } else {
            try {
                dataJSON = JSON.parse(data)
            } catch (e) {
                console.log("[Game] Error parsing game message.")
                console.error(e)
                return
            }
        }
        if (!dataJSON || typeof dataJSON.event !== "string") return
        if (!this.client) {
            //console.log("[Game] Connected.")
            this.client = socket
            this.emit("GAME_OPEN")
            this.bankToGame()
        }
        if (dataJSON.event == "ping") return
        // only events something listens for, and never EventEmitter's own
        if (RESERVED_GAME_EVENTS.has(dataJSON.event) || this.listenerCount(dataJSON.event) === 0) return
        this.emit(dataJSON.event, dataJSON.payload)
    }

    get isPaused() {
        return this.paused
    }

    get isHost() {
        return this.user.host
    }

    setUser(user) {
        this.user = user
    }

    setHost(val) {
        this.user.host = val
    }

    sendEvt(key, payload = {}) {
        this.toGame({ event: key, payload })
    }

    toGame(obj = {}) {
        if (!this.client) {
            //console.log("[Game] Pushed code to queue.")
            this.queue.push(obj)
            return
        }
        const evt = JSON.stringify(obj)
        this.client.send(evt)

        if (this.queue.length > 0) {
            setTimeout(() => {
                this.toGame(this.queue.shift())
            }, this.queueDelay)
        }
    }

    /** @param {NT.ServerRoomFlagsUpdated.GameFlag[]} toGameData */
    updateFlags(data) {
        // don't mutate the input!
        const toGameData = data.map((v) => ({ ...v }))

        // the mod reads this when a new game starts, before it can hear from us
        const seedFlag = toGameData.find((flag) => flag.flag === "NT_sync_world_seed")
        const ownLoadout = toGameData.some((flag) => flag.flag === "NT_random_loadouts")
        writeRoomSeed(
            seedFlag ? Number(seedFlag.uIntVal) || 0 : 0,
            ownLoadout ? loadoutShift(this.user.userId) : 0
        )

        // to avoid making changes to how the mod deals with flags, convert our pseudo-enum
        // ("NT_death_penalty", "end") into a boolean flag ("NT_death_penalty_end") before
        // sending to the mod
        const deathPenalty = toGameData.findIndex(
            (flag) => flag.flag === "NT_death_penalty"
        )
        if (deathPenalty > -1) {
            /** @type {NT.ServerRoomFlagsUpdated.GameFlag} */
            const flag = toGameData[deathPenalty]
            if (flag.strVal) {
                toGameData[deathPenalty] = {
                    flag: `${flag.flag}_${flag.strVal}`
                }
            }
            // shared health shares max hp, so hearts must not be handed out a second time
            if (flag.strVal === "shared_health") {
                for (let i = toGameData.length - 1; i >= 0; i--) {
                    if (toGameData[i].flag === "NT_sync_hearts") toGameData.splice(i, 1)
                }
            }
        }

        // the ban list is a string flag; the mod still switches its perk ban code on with
        // NT_ban_perks, which has to come after NT_banned_perks
        const bannedPerks = toGameData.find((flag) => flag.flag === "NT_banned_perks")
        if (bannedPerks && bannedPerks.strVal) {
            toGameData.push({ flag: "NT_ban_perks" })
        }

        // one shared wallet: nothing to deposit in the gold bank
        if (toGameData.some((entry) => entry.flag === "NT_shared_gold")) {
            for (let i = toGameData.length - 1; i >= 0; i--) {
                if (toGameData[i].flag === "NT_send_gold") toGameData.splice(i, 1)
            }
        }

        const onDeathKick = toGameData.some(
            (entry) => entry.flag == "NT_ondeath_kick"
        )
        if (this.isHost) {
            this.onDeathKick = onDeathKick
            toGameData.push({ flag: "NT_is_host" })
        }

        toGameData.push({ flag: "NT_GAMEMODE_CO_OP" }) //hardcode this for now :) <3

        // store a copy in case the game asks for it
        this.gameFlags = toGameData.map((v) =>
            NT.ServerRoomFlagsUpdated.GameFlag.create(v)
        )
        this.sendEvt("UpdateFlags", this.gameFlags)
    }

    addPlayer(data) {
        this.players[data.userId] = data
        if (!this.client) {
            return
        }
        this.sendEvt("AddPlayer", data)
    }

    removePlayer(data, reason) {
        delete this.players[data.userId]
        data['reason'] = reason
        this.sendEvt("RemovePlayer", data)
    }

    bankToGame() {
        const bank = []
        for (const wand of this.bank.wands) {
            bank.push(wand)
        }
        for (const spell of this.bank.spells) {
            bank.push(spell)
        }
        for (const item of this.bank.flasks) {
            bank.push(item)
        }
        for (const item of this.bank.objects) {
            bank.push(item)
        }
        this.sendEvt("ItemBank", { items: bank, gold: this.bank.gold })
    }

    setSpellList(data) {
        // the host's "Filter invalid data" option checks deposited spells against this
        if (data && Array.isArray(data.spells)) gameData.setSpells(data.spells)
    }

    sendPlayerList() {
        for (let player in this.players) {
            this.sendEvt("AddPlayer", this.players[player])
        }
    }

    reset() {
        writeRoomSeed(0)
        this.setHost(false)
        this.rejectConnections = true
        this.spellList = []
        this.gameFlags = []
        this.players = {}
        this.bank = {
            wands: [],
            spells: [],
            flasks: [],
            objects: [],
            gold: 0
        }
    }

    /**
     * @param {NT.ServerPlayerMoves} payload
     */
    sPlayerMoves(payload) {
        payload.userFrames.forEach(this.sPlayerMove, this)
    }

    /**
     * @param {NT.CompactPlayerFrames} payload
     */
    sPlayerMove(payload) {
        try {
            if (payload.userId == this.user.userId || !this.client) {
                return
            }

            // convert PlayerMove -> PlayerPosition when the player in question is too far
            // away from us. this saves client resources by not "replaying" the movements
            // of players we can't see
            const dist =
                (payload.xInit - this.lastX) ** 2 +
                (payload.yInit - this.lastY) ** 2
            if (!isNaN(dist) && dist > distSquaredThreshold) {
                const playerPos = {
                    userId: payload.userId,
                    x: payload.xInit,
                    y: payload.yInit
                }
                this.sendEvt("PlayerPos", playerPos)
                return
            }

            const decoded = decodeFrames(payload)
            // normal frame behavior instead
            const frames = []
            for (const [index, current] of decoded.entries()) {
                frames.push(current)
                const next = decoded[index + 1]
                if (typeof next !== "undefined") {
                    const med = {
                        x: lerp(current.x, next.x, 0.869),
                        y: lerp(current.y, next.y, 0.869),
                        armR: rotLerp(current.armR, next.armR, 0.869),
                        armScaleY: current.armScaleY,
                        scaleX: next.scaleX,
                        anim: next.anim,
                        held: next.held
                    }
                    frames.push(med)
                }
            }
            const jank = frames
                .map((current) => {
                    return `${current.armR},${current.armScaleY},${current.x},${current.y},${current.scaleX},${current.anim},${current.held},`
                })
                .join(",")
            this.sendEvt("PlayerMove", { userId: payload.userId, frames, jank })
        } catch (error) {
            console.log(error)
        }
    }
    // sPlayerPos(payload) {
    //     if (payload.userId == this.user.userId || !this.client) {
    //         return
    //     }
    //     this.sendEvt("PlayerPos", payload)
    // }
    sPlayerUpdate(payload) {
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("PlayerUpdate", payload)
    }
    sPlayerUpdateInventory(payload) {
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("PlayerUpdateInventory", payload)
    }
    sHostItemBank(payload) {
        this.bank = {
            wands: payload.wands,
            spells: payload.spells,
            flasks: payload.items,
            objects: payload.objects,
            gold: payload.gold
        }
        this.bankToGame()
    }
    sHostUserTake(payload) {
        if (!payload.success) {
            if (payload.userId == this.user.userId) {
                this.sendEvt("UserTakeFailed", payload)
            }
            return
        }
        for (const key in this.bank) {
            if (key == "gold") {
                continue
            }
            for (const [index, item] of this.bank[key].entries()) {
                if (item.id == payload.id) {
                    this.bank[key].splice(index, 1)
                    this.sendEvt("UserTakeSuccess", {
                        me: payload.userId == this.user.userId,
                        ...payload
                    })
                }
            }
        }
    }
    /**
     * @param {NT.ServerPlayerAddItem} message
     */
    sPlayerAddItem(message) {
        const pbjs = NT.ServerPlayerAddItem.create(message)

        const key = pbjs.item
        if (key == null) return

        const payload = pbjs[key]
        if (!payload) return

        const items = payload.list
        Array.prototype.push.apply(this.bank[key], items)
        this.sendEvt("UserAddItems", { userId: payload.userId, items }) //filter later?
    }
    sPlayerAddGold(payload) {
        this.bank.gold += payload.amount
        this.sendEvt("UserAddGold", payload)
    }
    sPlayerTakeGold(payload) {
        if (!this.isHost) {
            return
        }
        if (this.bank.gold >= payload.amount) {
            this.emit("HostTakeGold", {
                userId: payload.userId,
                amount: payload.amount,
                success: true
            })
        } else {
            this.emit("HostTakeGold", {
                userId: payload.userId,
                amount: payload.amount,
                success: false
            })
        }
    }
    sHostUserTakeGold(payload) {
        if (payload.success) {
            this.bank.gold -= payload.amount
            this.sendEvt("UserTakeGoldSuccess", {
                me: payload.userId == this.user.userId,
                ...payload
            })
        } else if (payload.userId == this.user.userId) {
            this.sendEvt("UserTakeGoldFailed", {
                me: payload.userId == this.user.userId,
                ...payload
            })
        }
    }
    sPlayerTakeItem(payload) {
        if (!this.isHost) {
            return
        }
        for (const key in this.bank) {
            if (key == "gold") {
                continue
            }
            for (const item of this.bank[key]) {
                if (item.id == payload.id) {
                    this.emit("HostTake", {
                        userId: payload.userId,
                        id: payload.id,
                        success: true
                    })
                    return
                }
            }
        }
        this.emit("HostTake", {
            userId: payload.userId,
            id: payload.id,
            success: false
        })
    }
    /**
     * @param {NT.ServerPlayerPickup} message
     */
    sPlayerPickup(message) {
        const pbjs = NT.ServerPlayerPickup.create(message)

        const player =
            message.userId == this.user.userId
                ? this.user
                : this.players[message.userId]
        const type = pbjs.kind
        if (type == null) return

        const payload = pbjs[type]
        if (!payload) return

        if (player) {
            sysMsg(`${player.name} picked up a ${type}.`)
        }
        if (message.userId == this.user.userId) {
            return
        }
        this.sendEvt("PlayerPickup", {
            userId: message.userId,
            [type]: payload
        })
    }
    sPlayerDeath(payload) {
        const player =
            payload.userId == this.user.userId
                ? this.user
                : this.players[payload.userId]
        if (player) {
            sysMsg(`${player.name} has ${payload.isWin ? "won" : "died"}.`)
            if (
                this.isHost &&
                this.onDeathKick &&
                !payload.isWin &&
                this.user.userId != payload.userId
            ) {
                this.emit("death_kick", payload.userId)
            }
        }
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("PlayerDeath", payload)
    }
    //sPlayerNewGamePlus (payload) => {},
    sPlayerSecretHourglass(payload) {
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("SecretHourglass", payload)
    }
    sCustomModEvent(payload) {
        if (payload.userId == this.user.userId) {
            return
        }
        try {
            // userId last: the sender's JSON can't claim to be someone else
            this.sendEvt("CustomModEvent", {
                ...JSON.parse(payload.payload),
                userId: payload.userId
            })
        } catch (error) {}
    }
    sRespawnPenalty(payload) {
        const player =
            payload.userId == this.user.userId
                ? this.user
                : this.players[payload.userId]
        if (player) {
            sysMsg(`${player.name} had to respawn against their will.`)
            if (
                this.isHost &&
                this.onDeathKick &&
                this.user.userId != payload.userId
            ) {
                this.emit("death_kick", payload.userId)
            }
        }
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("RespawnPenalty", payload)
    }
    sAngerySteve(payload) {
        const player =
            payload.userId == this.user.userId
                ? this.user
                : this.players[payload.userId]
        if (player) {
            sysMsg(`${player.name} has angered the gods.`)
        }
        if (payload.userId == this.user.userId) {
            return
        }
        this.sendEvt("AngerySteve", payload)
    }
    /*
    sNemesisPickupItem (payload) => {},
    sNemesisAbility (payload) => {},
    */
    sChat(payload) {
        // only while the game is connected: old chat shouldn't pile up for later
        if (!this.client || !payload) return
        this.sendEvt("Chat", { name: payload.name || "", message: payload.message || "" })
    }
}

module.exports = new NoitaGame()
