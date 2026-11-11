"use strict"
// The room logic that used to run on the noitatogether.com lobby server, now
// run inside the room host's app. Everyone else sends their messages to the
// host over Steam and gets back exactly what the server used to send them.
//
// Ported from Noita-Together/lobby-server: src/state/room.ts, the room
// handlers in src/state/lobby.ts, src/state/user.ts, src/state/stats_recorder.ts
// and src/runtypes/room_opts.ts. Behaviour matches the server unless a comment
// says otherwise.
const { NT } = require("@noita-together/nt-message")
const { v4: uuidv4 } = require("uuid")
const { DataFilter } = require("./dataFilter")

const SYSTEM_USER = { id: "-1", name: "[SYSTEM]" }
// runtypes/room_opts.ts: printable ascii, 1-50 chars
const ASCII_RE = /^[\x20-\x7F]+$/
// The server allowed up to 30 slots (120 for privileged users). There are no
// privileged users without the auth server, so everyone gets the larger limit.
const MAX_USERS_LIMIT = 120
// "Filter invalid data" and "Kick repeat offenders" room options (host-side only)
const FILTER_FLAG = "NT_filter_invalid_data"
const FILTER_KICK_FLAG = "NT_filter_kick"
const FILTER_KICK_AFTER = 5
// count a player's floods, and tell the host about a problem, at most this often
const FILTER_NOTICE_MS = 10000

const lobbyMsg = (key, payload) => NT.Envelope.encode({ lobbyAction: { [key]: payload } }).finish()
const gameMsg = (key, payload) => NT.Envelope.encode({ gameAction: { [key]: payload } }).finish()
const chatMsg = (user, message) => gameMsg("sChat", { id: uuidv4(), userId: user.id, name: user.name, message })

const present = (v) => v !== undefined && v !== null

// Not part of the lobby server: when the host turns on this flag, the host's
// app picks the world seed (NT_sync_world_seed) itself, and picks a new one
// after every run, so everyone shares a fresh random world each run.
const SHARED_SEED_FLAG = "NT_random_shared_seed"
const SEED_FLAG = "NT_sync_world_seed"
const randomSeed = () => Math.floor(Math.random() * 4294967295) + 1

/**
 * Port of validateRoomOpts(). Reads fields explicitly: protobufjs keeps
 * default values (e.g. gamemode 0) on the prototype, so spreading a decoded
 * message would drop them.
 * @returns {string|object} error string or validated options
 */
function validateRoomOpts(payload, partial) {
    const opts = {}
    const bad = []
    const checkString = (key, required) => {
        const raw = payload[key]
        if (!present(raw) || raw === "") {
            if (required) bad.push(key)
            return
        }
        const val = String(raw).trim()
        if (val.length < 1 || val.length > 50 || !ASCII_RE.test(val)) bad.push(key)
        else opts[key] = val
    }
    checkString("name", !partial)
    checkString("password", false)

    if (present(payload.gamemode)) {
        if (!Number.isInteger(payload.gamemode) || payload.gamemode < 0) bad.push("gamemode")
        else opts.gamemode = payload.gamemode
    } else if (!partial) bad.push("gamemode")

    if (present(payload.maxUsers)) {
        const n = payload.maxUsers
        if (!Number.isInteger(n) || n < 1 || n > MAX_USERS_LIMIT) bad.push("maxUsers")
        else opts.maxUsers = n
    } else if (!partial) bad.push("maxUsers")

    if (present(payload.locked)) opts.locked = !!payload.locked
    else if (!partial) opts.locked = false

    if (bad.length > 0) return `Invalid ${bad.join(", ")}`
    return opts
}

// stats_recorder.ts
const StatsEvent = ["SteveKill", "UserDeath", "UserWin", "HeartPickup", "OrbPickup"]
class StatsRecorder {
    constructor() {
        this.usernames = new Map()
        this.counters = new Map()
    }
    initUsers(users) {
        for (const { id, name } of users) {
            if (this.usernames.has(id)) continue
            this.usernames.set(id, name)
            this.counters.set(id, newCounters())
        }
    }
    increment(user, event) {
        this.usernames.set(user.id, user.name)
        const counters = this.counters.get(user.id) || newCounters()
        counters[event]++
        this.counters.set(user.id, counters)
    }
    /**
     * The server published these as a web page. Without a server we post a
     * summary to the room chat instead.
     */
    toChatLines() {
        const lines = []
        for (const [userId, c] of this.counters) {
            const name = this.usernames.get(userId)
            lines.push(
                `${name}: ${c.UserDeath} deaths, ${c.UserWin} wins, ${c.HeartPickup} hearts, ${c.OrbPickup} orbs, ${c.SteveKill} steve`
            )
        }
        return lines
    }
}
function newCounters() {
    const c = {}
    for (const e of StatsEvent) c[e] = 0
    return c
}

/** NT_death_penalty values where one player's death ends the run for everyone */
const RUN_ENDING_PENALTIES = ["end", "weak_respawn", "shared_health"]

class RoomUser {
    constructor(id, name) {
        this.id = id
        this.name = name
        this.connected = true
        /** @type {NT.IClientReadyState} */
        this.readyState = { ready: false, mods: [] }
    }
    mods() {
        return JSON.stringify(this.readyState.mods || [])
    }
}

class HostRoom {
    /**
     * @param {object} params
     * @param {string} params.id room id (the Steam lobby id)
     * @param {{id: string, name: string}} params.owner
     * @param {object} params.opts output of HostRoom.validateCreate
     * @param {(userId: string, msg: Uint8Array) => void} params.send
     * @param {() => void} [params.onLobbyStateChange] called when lobby-list info changes
     * @param {() => void} [params.onDestroyed]
     * @param {() => void} [params.onRunOver] called when a run ends, however it ended
     */
    constructor({ id, owner, opts, send, onLobbyStateChange, onDestroyed, onRunOver }) {
        this.id = id
        this.sendRaw = send
        this.onLobbyStateChange = onLobbyStateChange || (() => {})
        this.onDestroyed = onDestroyed || (() => {})
        this.onRunOver = onRunOver || (() => {})

        this.users = new Map()
        this.bannedUsers = new Set()
        this.allowedMods = new Map()

        this.name = opts.name
        this.password = opts.password
        this.gamemode = opts.gamemode
        this.maxUsers = opts.maxUsers
        this.locked = false
        this.inProgress = false
        /** @type {Set<string>} players who died or won in this run */
        this.runFinished = new Set()

        this.lastFlags = lobbyMsg("sRoomFlagsUpdated", {})
        /** @type {object[]} flags as last set by the host, with the seed filled in */
        this.flags = []
        this.sharedSeed = 0
        this.stats = null
        this.destroyed = false

        this.filter = new DataFilter()
        /** @type {Map<string, {count: number, notices: Map<string, number>}>} */
        this.offences = new Map()
        /** @type {import("./devBots").DevBots|null} fake players for testing (NT_DEV_BOTS) */
        this.devBots = null

        this.owner = new RoomUser(owner.id, owner.name)
        this.users.set(this.owner.id, this.owner)
    }

    /** lobby.ts cRoomCreate + RoomState.create validation */
    static validateCreate(payload) {
        return validateRoomOpts(payload, false)
    }

    /** RoomState.create: confirm creation to the owner */
    sendCreated() {
        this.send(this.owner, lobbyMsg("sRoomCreated", this.getState(this.owner)))
    }

    /** Lobby metadata shown in other players' room lists */
    lobbyData() {
        return {
            name: this.name,
            gamemode: this.gamemode,
            max_users: this.maxUsers,
            protected: !!this.password,
            locked: this.locked,
            owner_name: this.owner.name,
            in_progress: this.inProgress
        }
    }

    getState(forUser) {
        return {
            id: this.id,
            name: this.name,
            gamemode: this.gamemode,
            curUsers: this.users.size,
            maxUsers: this.maxUsers,
            protected: !!this.password,
            locked: this.locked,
            owner: this.owner.name,
            // the server sent the password to everyone who joined; only the owner gets it here
            password: forUser === this.owner ? this.password || "" : "",
            users: [...this.users.values()]
                .filter((u) => u.connected)
                .map((u) => ({ userId: u.id, name: u.name, ready: !!u.readyState.ready, owner: u === this.owner }))
        }
    }

    //// transport ////

    send(user, msg) {
        if (!user.connected) return
        this.sendRaw(user.id, msg)
    }

    /** RoomState.broadcast (to every connected user in the room) */
    broadcast(msg, exceptId) {
        for (const user of this.users.values()) {
            if (user.id === exceptId) continue
            this.send(user, msg)
        }
    }

    /**
     * Entry point for every envelope sent by a room member (or someone who
     * wants to join). `fromId` is authenticated by Steam.
     * @param {string} fromId
     * @param {string} fromName
     * @param {NT.Envelope} env
     */
    handleMessage(fromId, fromName, env) {
        if (this.destroyed || !env) return
        let key, payload, handlers
        if (env.lobbyAction) {
            key = env.lobbyAction.action
            payload = key && env.lobbyAction[key]
            handlers = lobbyHandlers
        } else if (env.gameAction) {
            key = env.gameAction.action
            payload = key && env.gameAction[key]
            handlers = gameHandlers
        }
        if (!key || !payload) return

        if (key === "cJoinRoom") {
            // not in the room yet, so just drop extra attempts quietly
            if (this.hasFlag(FILTER_FLAG) && this.filter.check(fromId, key, payload)) return
            this.join(fromId, fromName, payload.password)
            return
        }

        const user = this.users.get(fromId)
        if (!user || !user.connected) return
        if (user !== this.owner && this.hasFlag(FILTER_FLAG)) {
            const reason = this.filter.check(user.id, key, payload, { bannedPerks: this.bannedPerks() })
            if (reason) {
                this.invalidData(user, reason)
                return
            }
        }
        const handler = handlers[key]
        if (handler) {
            try {
                handler.call(this, payload, user)
            } catch (e) {
                console.error(`[host] error handling ${key}`, e)
            }
        }
    }

    hasFlag(name) {
        return this.flags.some((f) => f.flag === name)
    }

    bannedPerks() {
        const flag = this.flags.find((f) => f.flag === "NT_banned_perks")
        return flag && flag.strVal ? flag.strVal.split(",").filter(Boolean) : []
    }

    /** A message from `user` was dropped by the data filter. */
    invalidData(user, reason) {
        const now = Date.now()
        let o = this.offences.get(user.id)
        if (!o) {
            o = { count: 0, notices: new Map() }
            this.offences.set(user.id, o)
        }
        // a flood drops many messages; count and report it like one problem
        const last = o.notices.get(reason)
        if (last !== undefined && now - last < FILTER_NOTICE_MS) return
        o.notices.set(reason, now)
        o.count++
        console.log(`[host] dropped a message from ${user.name} (${user.id}): ${reason}`)
        this.send(this.owner, chatMsg(SYSTEM_USER, `[Filter] ${user.name} ${reason}. The message was dropped.`))
        if (this.hasFlag(FILTER_KICK_FLAG) && o.count >= FILTER_KICK_AFTER) {
            this.offences.delete(user.id)
            this.filter.forget(user.id)
            this.removeUser(this.owner, user, "sUserKicked", "was kicked for sending invalid data.")
        }
    }

    /** The Steam lobby reported that this peer is gone. */
    peerLeft(userId) {
        const user = this.users.get(userId)
        if (!user || !user.connected) return
        this.disconnected(user)
    }

    //// room.ts ////

    join(userId, name, password) {
        let reason = null
        let joinMessage = "joined the room."
        let user = this.users.get(userId)

        if (!user) {
            if (this.bannedUsers.has(userId)) reason = "Banned from this room."
            else if (this.users.size >= this.maxUsers) reason = "Room is full."
            else if (this.password && this.password !== password) reason = "Bad password."
            else if (this.locked) reason = "Room is locked."
        } else {
            // user disconnected during a run and is coming back (the server kept
            // them in the room for exactly this)
            joinMessage = "rejoined the room."
        }

        if (reason) {
            this.sendRaw(userId, lobbyMsg("sJoinRoomFailed", { reason }))
            return
        }

        if (!user) {
            user = new RoomUser(userId, name)
            this.users.set(userId, user)
        }
        user.connected = true
        if (name) user.name = name

        this.broadcast(lobbyMsg("sUserJoinedRoom", { userId: user.id, name: user.name }), user.id)
        this.broadcast(chatMsg(SYSTEM_USER, `${user.name} ${joinMessage}`), user.id)

        // user.ts joined()
        this.send(user, lobbyMsg("sJoinRoomSuccess", this.getState(user)))
        this.send(user, this.lastFlags)
        for (const other of this.users.values()) {
            if (other === user || !other.connected) continue
            this.send(user, lobbyMsg("sUserReadyState", Object.assign({ userId: other.id }, other.readyState)))
        }
        this.onLobbyStateChange()
    }

    removeUser(actor, target, key, message) {
        // admin actions (kick/ban) are owner-only
        if (actor !== null && actor !== this.owner) return
        // when the owner leaves the room, destroy it
        if (this.delete(target)) return

        this.users.delete(target.id)

        // the server published this before unsubscribing the target, so they get it too
        const msg = lobbyMsg(key, { userId: target.id })
        this.broadcast(msg)
        this.send(target, msg)

        this.broadcast(chatMsg(SYSTEM_USER, `${target.name} ${message}`))
        this.onLobbyStateChange()
        this.endIfEveryoneDone()
    }

    part(actor) {
        this.removeUser(null, actor, "sUserLeftRoom", "has left.")
    }

    disconnected(actor) {
        if (actor === this.owner) {
            this.destroy()
            return
        }
        if (this.inProgress) {
            // keep them in the room so they can come back to the run
            actor.connected = false
            this.broadcast(lobbyMsg("sUserLeftRoom", { userId: actor.id }))
            this.broadcast(chatMsg(SYSTEM_USER, `${actor.name} disconnected.`))
            this.onLobbyStateChange()
            this.endIfEveryoneDone()
        } else {
            this.removeUser(null, actor, "sUserLeftRoom", "disconnected.")
        }
    }

    kick(actor, target) {
        this.removeUser(actor, target, "sUserKicked", "has been kicked from this room.")
    }

    ban(actor, target) {
        // the server added to the ban list before checking ownership; check first
        if (actor !== this.owner) return
        this.bannedUsers.add(target.id)
        this.removeUser(actor, target, "sUserBanned", "has been banned from this room.")
    }

    delete(actor) {
        if (actor !== this.owner) return false
        this.destroy()
        return true
    }

    destroy() {
        if (this.destroyed) return
        this.destroyed = true
        this.broadcast(lobbyMsg("sRoomDeleted", { id: this.id }))
        this.users.clear()
        this.onDestroyed()
    }

    update(actor, payload) {
        if (actor !== this.owner) return "Can't do that."
        const opts = validateRoomOpts(payload, true)
        if (typeof opts === "string") return opts

        if (opts.name !== undefined) this.name = opts.name
        if (opts.password !== undefined) this.password = opts.password
        if (opts.gamemode !== undefined) this.gamemode = opts.gamemode
        if (opts.maxUsers !== undefined) this.maxUsers = opts.maxUsers
        if (opts.locked !== undefined) this.locked = opts.locked

        // don't broadcast the password (the server did)
        const update = Object.assign({}, opts)
        delete update.password
        this.broadcast(lobbyMsg("sRoomUpdated", update))
        this.onLobbyStateChange()
    }

    setFlags(actor, payload) {
        if (actor !== this.owner) return "Can't do that."
        const flags = (payload.flags || []).map((f) => NT.ClientRoomFlagsUpdate.GameFlag.toObject(f))
        if (flags.some((f) => f.flag === SHARED_SEED_FLAG)) {
            // keep the current shared seed when other options change, so
            // nobody gets sent back to a new game for no reason
            if (!this.sharedSeed) this.sharedSeed = randomSeed()
        } else {
            this.sharedSeed = 0
        }
        this.publishFlags(flags)
    }

    publishFlags(flags) {
        if (this.sharedSeed) {
            flags = flags.filter((f) => f.flag !== SEED_FLAG)
            flags.push({ flag: SEED_FLAG, uIntVal: this.sharedSeed })
        }
        this.flags = flags
        // replayed to everyone who joins later
        this.lastFlags = lobbyMsg("sRoomFlagsUpdated", { flags })
        this.broadcast(this.lastFlags)
    }

    onUserReadyStateChange(actor, payload) {
        this.broadcast(lobbyMsg("sUserReadyState", Object.assign({ userId: actor.id }, payload)))

        // if the run is in progress and the user's mods haven't changed since it
        // started, let them straight back in
        if (this.inProgress && payload.ready) {
            if (this.allowedMods.get(actor.id) !== actor.mods()) return
            this.send(actor, lobbyMsg("sHostStart", { forced: false }))
        }
    }

    startRun(actor) {
        if (actor !== this.owner) return
        if (this.gamemode === 0) {
            // only tracking coop stats, like the server
            if (!this.stats) this.stats = new StatsRecorder()
            this.stats.initUsers(this.users.values())
        }
        for (const user of this.users.values()) {
            this.allowedMods.set(user.id, user.mods())
        }
        this.inProgress = true
        this.runFinished = new Set()
        this.broadcast(lobbyMsg("sHostStart", { forced: false }))
        this.onLobbyStateChange()
    }

    /** The host pressed End Run: every game in the run ends, then the room's run does. */
    endRun(actor) {
        if (actor !== this.owner || !this.inProgress) return
        this.broadcast(chatMsg(SYSTEM_USER, "The host ended the run."))
        // only the room sends events as SYSTEM_USER, so the mod knows this came from the host
        this.broadcast(gameMsg("sCustomModEvent", {
            userId: SYSTEM_USER.id,
            payload: JSON.stringify({ name: "EndRun" })
        }))
        this.finishRun(actor)
    }

    finishRun(actor) {
        // the host's game also reports the end after End Run; count it once
        if (actor !== this.owner || !this.inProgress) return
        if (this.stats) {
            this.broadcast(chatMsg(SYSTEM_USER, "Run stats:"))
            for (const line of this.stats.toChatLines()) {
                this.broadcast(chatMsg(SYSTEM_USER, line))
            }
        }
        this.inProgress = false
        this.runFinished = new Set()
        this.stats = null
        this.allowedMods = new Map()
        // users that dropped during the run no longer get a seat held for them
        for (const user of [...this.users.values()]) {
            if (!user.connected) this.users.delete(user.id)
        }
        if (this.sharedSeed) {
            this.sharedSeed = randomSeed()
            this.broadcast(chatMsg(SYSTEM_USER, "New shared world seed for the next run."))
            this.publishFlags(this.flags)
        }
        this.onLobbyStateChange()
        this.onRunOver()
    }

    /**
     * A player died or won. In co-op, a death ends the run for everyone with these
     * death penalties (the mod ends each game itself). Otherwise the run ends once
     * every player still in it has died or won.
     */
    onPlayerFinished(user, payload) {
        this.runFinished.add(user.id)
        const penalty = this.flags.find((f) => f.flag === "NT_death_penalty")
        const endsRun = penalty && RUN_ENDING_PENALTIES.includes(penalty.strVal)
        if (this.gamemode === 0 && !payload.isWin && endsRun) {
            this.finishRun(this.owner)
            return
        }
        this.endIfEveryoneDone()
    }

    /** Ends the run once every player still in it has died or won. */
    endIfEveryoneDone() {
        if (!this.inProgress) return
        // players the run started with (see startRun) who are still here
        const playing = [...this.users.values()].filter((u) => u.connected && this.allowedMods.has(u.id))
        if (playing.every((u) => this.runFinished.has(u.id))) this.finishRun(this.owner)
    }
}

// lobby.ts room-related handlers
const lobbyHandlers = {
    cRoomDelete(payload, user) {
        this.delete(user)
    },
    cRoomUpdate(payload, user) {
        const reason = this.update(user, payload)
        if (reason) this.send(user, lobbyMsg("sRoomUpdateFailed", { reason }))
    },
    cRoomFlagsUpdate(payload, user) {
        const reason = this.setFlags(user, payload)
        if (reason) this.send(user, lobbyMsg("sRoomFlagsUpdateFailed", { reason }))
    },
    cLeaveRoom(payload, user) {
        this.part(user)
    },
    cKickUser(payload, user) {
        const target = this.users.get(payload.userId)
        if (target) this.kick(user, target)
    },
    cBanUser(payload, user) {
        const target = this.users.get(payload.userId)
        if (target) this.ban(user, target)
    },
    cReadyState(payload, user) {
        user.readyState = payload
        this.onUserReadyStateChange(user, payload)
    },
    cStartRun(payload, user) {
        this.startRun(user)
    },
    cRunOver(payload, user) {
        // idk is an unused field from the old server; the app sets it for End Run
        if (payload.idk) this.endRun(user)
        else this.finishRun(user)
    },
    cRoomCreate(payload, user) {
        this.send(user, lobbyMsg("sRoomCreateFailed", { reason: "Already in a room." }))
    }
}

// room.ts message handlers. "ignoreSelf" in the original code is
// broadcast(msg, user.id); "toHost" is send(owner).
const withUser = (user, payload) => Object.assign({ userId: user.id }, payload)
const gameHandlers = {
    cPlayerMove(payload, user) {
        if (!this.inProgress) return
        const frames = Object.assign({}, payload, { userId: user.id })
        this.broadcast(gameMsg("sPlayerMoves", { userFrames: [frames] }), user.id)
        if (this.devBots && user === this.owner) this.devBots.ownerMoved(payload)
    },
    cPlayerUpdate(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerUpdate", withUser(user, payload)), user.id)
    },
    cPlayerUpdateInventory() {
        // not implemented in the server either
    },
    cHostItemBank(payload, user) {
        if (!this.inProgress) return
        if (user !== this.owner) return
        this.broadcast(gameMsg("sHostItemBank", payload))
    },
    cHostUserTake(payload, user) {
        if (!this.inProgress) return
        if (user !== this.owner) return
        this.broadcast(gameMsg("sHostUserTake", payload))
    },
    cHostUserTakeGold(payload, user) {
        if (!this.inProgress) return
        if (user !== this.owner) return
        this.broadcast(gameMsg("sHostUserTakeGold", payload))
    },
    cPlayerAddGold(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerAddGold", withUser(user, payload)))
    },
    cPlayerTakeGold(payload, user) {
        if (!this.inProgress) return
        this.send(this.owner, gameMsg("sPlayerTakeGold", withUser(user, payload)))
    },
    cPlayerAddItem(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerAddItem", withUser(user, payload)))
    },
    cPlayerTakeItem(payload, user) {
        if (!this.inProgress) return
        this.send(this.owner, gameMsg("sPlayerTakeItem", withUser(user, payload)))
    },
    cPlayerPickup(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerPickup", withUser(user, payload)), user.id)
        if (!this.stats) return
        if (payload.kind === "heart") this.stats.increment(user, "HeartPickup")
        else if (payload.kind === "orb") this.stats.increment(user, "OrbPickup")
    },
    cNemesisAbility(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sNemesisAbility", withUser(user, payload)), user.id)
    },
    cNemesisPickupItem(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sNemesisPickupItem", withUser(user, payload)), user.id)
    },
    cPlayerNewGamePlus(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerNewGamePlus", withUser(user, payload)), user.id)
    },
    cPlayerSecretHourglass(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sPlayerSecretHourglass", withUser(user, payload)), user.id)
    },
    cCustomModEvent(payload, user) {
        if (!this.inProgress) return
        this.broadcast(gameMsg("sCustomModEvent", withUser(user, payload)))
    },
    cAngerySteve(payload, user) {
        if (!this.inProgress) return
        if (this.stats) this.stats.increment(user, "SteveKill")
        this.broadcast(gameMsg("sAngerySteve", withUser(user, payload)), user.id)
    },
    cRespawnPenalty(payload, user) {
        if (!this.inProgress) return
        if (this.stats) this.stats.increment(user, "UserDeath")
        this.broadcast(gameMsg("sRespawnPenalty", withUser(user, payload)), user.id)
    },
    cPlayerDeath(payload, user) {
        if (!this.inProgress) return
        if (this.stats) this.stats.increment(user, payload.isWin ? "UserWin" : "UserDeath")
        this.broadcast(gameMsg("sPlayerDeath", withUser(user, payload)), user.id)
        this.onPlayerFinished(user, payload)
    },
    cChat(payload, user) {
        if (!payload.message) return
        const msg = payload.message
        if (user === this.owner && msg.startsWith("/")) {
            if (this.devBots && this.devBots.command(msg)) return
            if (msg.toLowerCase() === "/endrun") this.finishRun(user)
            return
        }
        this.broadcast(chatMsg(user, msg), user.id)
    }
}

module.exports = { HostRoom, SYSTEM_USER, lobbyMsg, gameMsg, chatMsg }
