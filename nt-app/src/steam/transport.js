"use strict"
// Stands in for the websocket to the old lobby server. The app still sends
// and receives exactly the same protobuf envelopes; this decides where they
// go:
//   - room list / create / join  -> Steam lobbies (via the bridge)
//   - while hosting              -> the HostRoom running in this app
//   - while in someone's room    -> the host, over Steam P2P
const EventEmitter = require("events")
const { NT } = require("@noita-together/nt-message")
const defaultBridge = require("./bridge")
const { HostRoom, SYSTEM_USER, lobbyMsg, chatMsg } = require("./hostRoom")
const { DevBots } = require("./devBots")

// Stored in lobby metadata; rooms with a different value aren't listed or joinable.
// Bump whenever the messages exchanged between apps change incompatibly.
const PROTOCOL_VERSION = "1"
const JOIN_TIMEOUT_MS = 30000
const LEAVE_FALLBACK_MS = 3000
const LOBBY_TYPES = ["public", "friends_only", "private"]

const State = {
    IDLE: "idle",
    CREATING: "creating",
    HOSTING: "hosting",
    JOINING: "joining",
    JOINED: "joined"
}

class SteamTransport extends EventEmitter {
    /**
     * @param {{userId: string, name: string}} user the local Steam user
     * @param {string} appVersion
     * @param {object} [bridge] injectable for tests
     */
    constructor(user, appVersion, bridge) {
        super()
        this.bridge = bridge || defaultBridge
        this.user = user
        this.appVersion = appVersion
        this.state = State.IDLE
        this.lobbyType = "public"
        /** @type {HostRoom|null} */
        this.room = null
        this.hostId = null
        this.lobbyId = null
        this.lobbyCode = null
        this.pendingJoin = null
        this.joinTimer = null
        this.leaveTimer = null
        this.connectedPeers = new Set()
        this.peerNames = new Map()

        this.bridgeHandlers = {
            peer_joined: (ev) => this.rememberName(ev.steam_id, ev.name),
            peer_connected: (ev) => this.onPeerConnected(ev),
            peer_left: (ev) => this.onPeerLeft(ev.steam_id),
            send_stuck: (ev) => this.onPeerLeft(ev.steam_id),
            message: (ev) => this.onPeerMessage(ev.from, Buffer.from(ev.data, "base64")),
            join_requested: (ev) => this.emit("joinRequested", { lobbyId: ev.lobby_id, code: ev.code }),
            exit: () => this.onBridgeExit()
        }
        for (const key of Object.keys(this.bridgeHandlers)) {
            this.bridge.on(key, this.bridgeHandlers[key])
        }
    }

    setLobbyType(type) {
        if (LOBBY_TYPES.includes(type)) this.lobbyType = type
    }

    /**
     * Everything the app used to write to the lobby server websocket.
     * @param {Uint8Array} buf encoded NT.Envelope
     */
    send(buf) {
        let env
        try {
            env = NT.Envelope.decode(buf)
        } catch (e) {
            console.error("[steam] could not decode outgoing message", e)
            return
        }
        const lobbyKey = env.lobbyAction && env.lobbyAction.action
        if (lobbyKey === "cRequestRoomList") {
            this.listRooms()
            return
        }
        if (lobbyKey === "cRoomCreate" && this.state !== State.HOSTING && this.state !== State.JOINED) {
            if (this.state === State.IDLE) this.createRoom(env.lobbyAction.cRoomCreate)
            else this.deliver(lobbyMsg("sRoomCreateFailed", { reason: "Already joining a room." }))
            return
        }
        if (lobbyKey === "cJoinRoom") {
            if (this.state === State.IDLE) this.joinRoom(env.lobbyAction.cJoinRoom, buf)
            else this.deliver(lobbyMsg("sJoinRoomFailed", { reason: "Already in a room." }))
            return
        }

        if (this.state === State.HOSTING) {
            this.room.handleMessage(this.user.userId, this.user.name, env)
        } else if (this.state === State.JOINED) {
            this.bridge.sendTo(this.hostId, buf)
            if (lobbyKey === "cLeaveRoom") this.armLeaveFallback()
        }
        // otherwise we're not in a room; the server ignored these too
    }

    /** Hand a server->client envelope to the app (asynchronously, like a socket). */
    deliver(buf) {
        let env = null
        try {
            env = NT.Envelope.decode(buf)
        } catch (e) {
            console.error("[steam] could not decode incoming message", e)
            return
        }
        this.inspectIncoming(env)
        setImmediate(() => this.emit("message", buf))
    }

    /** Track room membership from the same messages the app reacts to. */
    inspectIncoming(env) {
        const key = env.lobbyAction && env.lobbyAction.action
        if (!key) return
        const payload = env.lobbyAction[key]
        switch (key) {
            case "sJoinRoomSuccess":
                if (this.state === State.JOINING) {
                    clearTimeout(this.joinTimer)
                    this.state = State.JOINED
                    this.emit("lobby", { lobbyId: this.lobbyId, code: this.lobbyCode, host: false })
                }
                break
            case "sJoinRoomFailed":
                if (this.state === State.JOINING) this.endSession()
                break
            case "sRoomDeleted":
                // give reliable messages a moment to go out before leaving
                this.endSession(500)
                break
            case "sUserLeftRoom":
            case "sUserKicked":
            case "sUserBanned":
                if (payload.userId === this.user.userId) this.endSession()
                break
        }
    }

    listRooms() {
        this.bridge
            .listLobbies({ nt_proto: PROTOCOL_VERSION })
            .then((lobbies) => lobbies.map(lobbyToRoom))
            .catch((err) => {
                console.error("[steam] lobby list failed", err)
                return []
            })
            .then((rooms) => this.deliver(lobbyMsg("sRoomList", { rooms, pages: 0 })))
    }

    createRoom(payload) {
        const opts = HostRoom.validateCreate(payload)
        if (typeof opts === "string") {
            this.deliver(lobbyMsg("sRoomCreateFailed", { reason: opts }))
            return
        }
        this.state = State.CREATING
        this.connectedPeers.clear()
        const data = {
            nt_proto: PROTOCOL_VERSION,
            nt_version: this.appVersion,
            name: opts.name,
            gamemode: opts.gamemode,
            max_users: opts.maxUsers,
            protected: !!opts.password,
            locked: false,
            owner_name: this.user.name,
            in_progress: false
        }
        this.bridge
            .createLobby({ lobbyType: this.lobbyType, maxMembers: 250, data })
            .then((ev) => {
                if (this.state !== State.CREATING) {
                    this.bridge.leaveLobby()
                    return
                }
                this.lobbyId = ev.lobby_id
                this.lobbyCode = ev.code
                const room = new HostRoom({
                    id: ev.lobby_id,
                    owner: { id: this.user.userId, name: this.user.name },
                    opts,
                    send: (userId, msg) => {
                        if (userId === this.user.userId) this.deliver(msg)
                        else if (room.devBots && room.devBots.has(userId)) room.devBots.receive(userId, msg)
                        else this.bridge.sendTo(userId, msg)
                    },
                    onLobbyStateChange: () => {
                        if (this.room === room) this.bridge.setLobbyData(room.lobbyData())
                    },
                    onDestroyed: () => {
                        if (this.room === room) this.endSession(500)
                    },
                    onRunOver: () => {
                        if (this.room === room) this.emit("runOver")
                    }
                })
                this.room = room
                this.state = State.HOSTING
                this.emit("lobby", { lobbyId: this.lobbyId, code: this.lobbyCode, host: true })
                room.sendCreated()
                if (DevBots.enabled()) {
                    room.devBots = new DevBots(room, { NT, chat: (m) => room.send(room.owner, chatMsg(SYSTEM_USER, m)) })
                    room.devBots.reply("Test bots are on (NT_DEV_BOTS). Type /bot help in chat.")
                }
            })
            .catch((err) => {
                if (this.state !== State.CREATING) return
                this.state = State.IDLE
                this.deliver(lobbyMsg("sRoomCreateFailed", { reason: err.message }))
            })
    }

    joinRoom(payload, buf) {
        this.state = State.JOINING
        this.pendingJoin = buf
        this.connectedPeers.clear()
        this.joinTimer = setTimeout(
            () => this.failJoin("Could not connect to the host over Steam."),
            JOIN_TIMEOUT_MS
        )
        this.bridge
            .joinLobby(payload.id)
            .then((ev) => {
                if (this.state !== State.JOINING) return
                const data = lobbyData(ev.data)
                if (data.nt_proto !== PROTOCOL_VERSION) {
                    const theirs = data.nt_version || "an unknown version"
                    this.failJoin(`That room is running Noita Together ${theirs}, which isn't compatible with yours.`)
                    return
                }
                if (ev.owner_id === this.user.userId) {
                    this.failJoin("That's your own room.")
                    return
                }
                this.hostId = ev.owner_id
                this.lobbyId = ev.lobby_id
                this.lobbyCode = ev.code
                if (this.connectedPeers.has(this.hostId)) this.sendPendingJoin()
            })
            .catch((err) => this.failJoin(err.message))
    }

    sendPendingJoin() {
        if (!this.pendingJoin) return
        this.bridge.sendTo(this.hostId, this.pendingJoin)
        this.pendingJoin = null
        // keep the join timer running until the host answers
    }

    failJoin(reason) {
        if (this.state !== State.JOINING) return
        this.endSession()
        this.deliver(lobbyMsg("sJoinRoomFailed", { reason }))
    }

    armLeaveFallback() {
        clearTimeout(this.leaveTimer)
        // if the host never confirms, leave anyway so the UI doesn't hang
        this.leaveTimer = setTimeout(() => {
            if (this.state === State.JOINED) {
                this.deliver(lobbyMsg("sUserLeftRoom", { userId: this.user.userId }))
            }
        }, LEAVE_FALLBACK_MS)
    }

    /** Leave the Steam lobby and forget the room. Safe to call repeatedly. */
    endSession(leaveDelayMs = 0) {
        clearTimeout(this.joinTimer)
        clearTimeout(this.leaveTimer)
        const wasActive = this.state !== State.IDLE
        this.state = State.IDLE
        this.room = null
        this.hostId = null
        this.pendingJoin = null
        if (!wasActive) return
        if (leaveDelayMs > 0) {
            // starting a new lobby before this fires replaces the old one in the bridge anyway
            setTimeout(() => {
                if (this.state === State.IDLE) this.bridge.leaveLobby()
            }, leaveDelayMs)
        } else {
            this.bridge.leaveLobby()
        }
        this.emit("lobby", null)
    }

    rememberName(steamId, name) {
        if (name && name !== "[unknown]") this.peerNames.set(steamId, name)
    }

    onPeerConnected(ev) {
        this.connectedPeers.add(ev.steam_id)
        this.rememberName(ev.steam_id, ev.name)
        if (this.state === State.JOINING && ev.steam_id === this.hostId) this.sendPendingJoin()
    }

    onPeerLeft(steamId) {
        this.connectedPeers.delete(steamId)
        if (this.state === State.HOSTING) {
            this.room.peerLeft(steamId)
        } else if (steamId === this.hostId) {
            if (this.state === State.JOINING) {
                this.failJoin("The host left.")
            } else if (this.state === State.JOINED) {
                const roomId = this.lobbyId
                this.endSession()
                this.deliver(chatMsg(SYSTEM_USER, "Lost connection to the room host."))
                this.deliver(lobbyMsg("sRoomDeleted", { id: roomId }))
            }
        }
    }

    onPeerMessage(from, buf) {
        if (this.state === State.HOSTING) {
            let env
            try {
                env = NT.Envelope.decode(buf)
            } catch (e) {
                console.error(`[steam] bad message from ${from}`, e)
                return
            }
            this.room.handleMessage(from, this.peerNames.get(from) || "Player", env)
        } else if ((this.state === State.JOINING || this.state === State.JOINED) && from === this.hostId) {
            this.deliver(buf)
        }
    }

    onBridgeExit() {
        const wasInRoom = this.state === State.HOSTING || this.state === State.JOINED
        const roomId = this.lobbyId
        this.endSession()
        if (wasInRoom) this.deliver(lobbyMsg("sRoomDeleted", { id: roomId }))
        this.emit("closed")
    }

    close() {
        for (const key of Object.keys(this.bridgeHandlers)) {
            this.bridge.removeListener(key, this.bridgeHandlers[key])
        }
        if (this.room) this.room.destroy()
        this.endSession()
    }
}

/**
 * Steam treats lobby keys as case-insensitive and hands some back with its own
 * capitals ("gamemode" comes back as "GameMode", "owner_name" as "OWNER_NAME"),
 * so read them all in lower case.
 */
function lobbyData(raw) {
    const out = {}
    for (const key of Object.keys(raw || {})) out[key.toLowerCase()] = raw[key]
    return out
}

function lobbyToRoom(lobby) {
    const d = lobbyData(lobby.data)
    return {
        id: lobby.lobby_id,
        name: d.name || "Unnamed room",
        gamemode: parseInt(d.gamemode, 10) || 0,
        curUsers: lobby.members,
        maxUsers: parseInt(d.max_users, 10) || lobby.max_members,
        protected: d.protected === "1",
        locked: d.locked === "1",
        owner: d.owner_name || ""
    }
}

module.exports = { SteamTransport, PROTOCOL_VERSION, State, lobbyData, lobbyToRoom }
