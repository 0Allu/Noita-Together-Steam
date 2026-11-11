const { v4: uuidv4 } = require("uuid")
const { app, ipcMain } = require("electron")
const {
    encodeLobbyMsg,
    encodeGameMsg,
    decode
} = require("./handlers/messageHandler")
const appEvent = require("./appEvent")
const noita = require("./noita")
const { encodeFrames } = require("./frameCoder")
const { SteamTransport } = require("./steam/transport")

// The lobby server is gone: rooms are Steam lobbies, and the room host's app
// runs the room logic (see ./steam). Everything below still speaks the same
// protobuf messages it used to exchange with the server.
let connected = false
module.exports = (data) => {
    if (connected) {
        // already wired up (e.g. the login view retried)
        appEvent("CONNECTED", data)
        return
    }
    connected = true
    const user = { userId: data.id, name: data.display_name }
    noita.setUser({ userId: user.userId, name: user.name, host: false })
    let isHost = false

    console.log(`Connected to Steam as ${user.name} (${user.userId})`)
    let client = new SteamTransport(user, app.getVersion())

    const lobby = {
        sHostStart: (payload) => {
            if (isHost) {
                const msg = encodeGameMsg("cHostItemBank", {
                    wands: noita.bank.wands,
                    spells: noita.bank.spells,
                    items: noita.bank.flasks,
                    objects: noita.bank.objects,
                    gold: noita.bank.gold
                })
                sendMsg(msg)
            }
            noita.sendEvt("StartRun")
        },
        sUserBanned: (payload) => {
            if (payload.userId == user.userId) {
                noita.reset()
            } else {
                noita.removePlayer(payload, 'banned')
            }
        },
        sUserKicked: (payload) => {
            if (payload.userId == user.userId) {
                noita.reset()
            } else {
                noita.removePlayer(payload, 'kicked')
            }
        },
        sUserLeftRoom: (payload) => {
            if (payload.userId == user.userId) {
                noita.sendEvt('clientLeftRoom')
                noita.reset()
            } else {
                noita.removePlayer(payload, 'left/disconnected')
            }
        },
        sUserJoinedRoom: (payload) => {
            noita.addPlayer(payload)
        },
        sJoinRoomSuccess: (payload) => {
            noita.rejectConnections = false
            for (const player of payload.users) {
                if (player.userId == user.userId) {
                    continue
                }
                noita.addPlayer({ userId: player.userId, name: player.name })
            }
        },
        sRoomFlagsUpdated: (payload) => {
            noita.updateFlags(payload.flags)
        },
        sRoomCreated: (payload) => {
            noita.rejectConnections = false
            noita.setHost(true)
            isHost = true
        },
        sRoomDeleted: (payload) => {
            isHost = false
            noita.reset()
        }
    }

    // the room in this app ended its run (host only)
    client.on("runOver", () => {
        appEvent("RUN_OVER")
    })

    client.on("lobby", (info) => {
        appEvent("STEAM_LOBBY", info)
    })

    client.on("joinRequested", (info) => {
        appEvent("STEAM_JOIN_REQUESTED", info)
    })

    client.on("closed", () => {
        appEvent("CONNECTION_LOST", { code: 0, reason: "the Steam helper stopped. Is Steam still running?" })
        noita.clientDisconnected()
    })

    /**
     * @param {NT.GameAction} gameAction
     */
    function handleGameAction(gameAction) {
        const action = gameAction.action
        if (!action) return

        switch (action) {
            case "sChat":
                appEvent(action, gameAction[action])
                // and in game, where the mod prints it unless chat is hidden there
                noita.sChat(gameAction[action])
                break
            case "sStatUpdate":
                appEvent(action, gameAction[action])
                break
            default:
                if (typeof noita[action] === "function") {
                    noita[action](gameAction[action])
                } else {
                    console.error(`No handler for gameAction=${action}`)
                }
                break
        }
    }

    /**
     * @param {NT.LobbyAction} lobbyAction
     */
    function handleLobbyAction(lobbyAction) {
        const action = lobbyAction.action
        if (!action) return

        const payload = lobbyAction[action]
        if (!payload) return

        if (typeof lobby[action] == "function") {
            lobby[action](payload)
        }
        appEvent(action, payload)
    }

    client.on("message", (data) => {
        try {
            const msg = decode(data)
            if (!msg) return

            const actionType = msg.kind
            switch (actionType) {
                case "gameAction":
                    handleGameAction(msg.gameAction)
                    break
                case "lobbyAction":
                    handleLobbyAction(msg.lobbyAction)
                    break
                default:
                    console.error(`Unknown actionType=${actionType}`)
                    break
            }
        } catch (error) {
            console.log(error)
        }
    })

    ipcMain.on("STEAM_LOBBY_TYPE", (e, type) => {
        client.setLobbyType(type)
    })

    ipcMain.on("CLIENT_MESSAGE", (e, data) => {
        const msg = encodeLobbyMsg(data.key, data.payload)
        sendMsg(msg)
    })

    ipcMain.on("CLIENT_CHAT", (e, data) => {
        if(process.env.ALLOW_DEBUG_CHAT_COMMANDS){
            let chatMsg = data.payload.message
            //check
            if(chatMsg.startsWith('/') && chatMsg.split(' ').length > 1){
                console.log('We got a potential client command. Check it before we try sending it to the backend')
                let msgSplit = chatMsg.split(' ')
                let payload
                switch (msgSplit[0]){
                    case '/useradd':
                        payload = {
                            userId: msgSplit[1],
                            name: msgSplit[1]
                        }
                        console.log(`Sending fake sUserJoinedRoom with payload to self`, payload)
                        appEvent('sUserJoinedRoom', payload)
                        lobby.sUserJoinedRoom(payload)
                        return
                    case '/bulkusergen':
                        console.log(`Sending bulk fake sUserJoinedRoom with payload to self`, payload)
                        for(let i = 0; i < parseInt(msgSplit[1]); i++){
                            payload = {
                                userId: uuidv4(),
                                name: uuidv4()
                            }
                            appEvent('sUserJoinedRoom', payload)
                            lobby.sUserJoinedRoom(payload)
                        }
                        return
                    case '/userdel':
                        payload = {
                            userId: msgSplit[1]
                        }
                        console.log(`Sending fake sUserLeftRoom with payload to self`, payload)
                        lobby.sUserLeftRoom(payload)
                        appEvent('sUserLeftRoom', payload)
                        return
                    case '/fakedc':
                        noita.clientDisconnected()
                        return
                    case '/dcthesocket':
                        client.onPeerLeft(client.hostId)
                        return
                }
            }
        }

        const msg = encodeGameMsg(data.key, data.payload)
        sendMsg(msg)
    })

    noita.on("death_kick", (userId) => {
        const msg = encodeLobbyMsg("cKickUser", { userId })
        sendMsg(msg)
    })

    noita.on("GAME_OPEN", () => {
        appEvent("noita_connection", true)
        noita.sendEvt("RequestGameInfo")
        noita.sendEvt("RequestSpellList")

        noita.once("GameInfo", (event) => {
            const msg = encodeLobbyMsg("cReadyState", {
                ready: true,
                seed: event.seed,
                mods: event.mods,
                version: event.version,
                beta: event.beta
            })
            sendMsg(msg)
        })
    })

    noita.on("GAME_CLOSE", () => {
        appEvent("noita_connection", false)
        unready()
    })

    noita.on("PlayerMove", (event) => {
        // don't send empty move updates. don't know why this happens...
        if (!event || !event.frames || event.frames.length === 0) return

        if (event && event.frames && event.frames.length > 0) {
            const { x, y } = event.frames[event.frames.length - 1]
            noita.setLastPosition(x, y)
        }
        const cf = encodeFrames(event.frames)
        const msg = encodeGameMsg("cPlayerMove", cf)
        sendMsg(msg)
    })

    noita.on("PlayerUpdate", (event) => {
        const msg = encodeGameMsg("cPlayerUpdate", event)
        sendMsg(msg)
    })

    noita.on("PlayerPickup", (event) => {
        const msg = encodeGameMsg("cPlayerPickup", event)
        sendMsg(msg)
    })

    noita.on("PlayerDeath", (event) => {
        const msg = encodeGameMsg("cPlayerDeath", event)
        sendMsg(msg)
        unready()
    })

    noita.on("RunOver", () => {
        unready()
        if (isHost) {
            const msg = encodeLobbyMsg("cRunOver", { idk: false })
            sendMsg(msg)
        }
    })

    // End Run in the room: ends every player's game (see HostRoom.endRun)
    ipcMain.on("END_RUN", () => {
        if (!isHost) return
        sendMsg(encodeLobbyMsg("cRunOver", { idk: true }))
    })

    noita.on("SendGold", (event) => {
        const msg = encodeGameMsg("cPlayerAddGold", event)
        sendMsg(msg)
    })

    noita.on("TakeGold", (event) => {
        const msg = encodeGameMsg("cPlayerTakeGold", event)
        sendMsg(msg)
    })

    noita.on("AngerySteve", (event) => {
        const msg = encodeGameMsg("cAngerySteve", event)
        sendMsg(msg)
    })

    noita.on("RespawnPenalty", (event) => {
        const msg = encodeGameMsg("cRespawnPenalty", event)
        sendMsg(msg)
    })

    noita.on("SendItems", (event) => {
        /** @type {NT.ClientPlayerAddItem} */
        const msg = {}

        if (event.spells) {
            msg.spells = { list: event.spells.map(mapSpells) }
        } else if (event.flasks) {
            msg.flasks = { list: event.flasks.map(mapFlasks) }
        } else if (event.wands) {
            msg.wands = { list: event.wands.map(mapWands) }
        } else if (event.objects) {
            msg.objects = { list: event.objects.map(mapObjects) }
        }
        sendMsg(encodeGameMsg("cPlayerAddItem", msg))
    })

    noita.on("PlayerTake", (event) => {
        const msg = encodeGameMsg("cPlayerTakeItem", event)
        sendMsg(msg)
    })

    noita.on("HostTake", (event) => {
        const msg = encodeGameMsg("cHostUserTake", event)
        sendMsg(msg)
    })

    noita.on("HostTakeGold", (event) => {
        const msg = encodeGameMsg("cHostUserTakeGold", event)
        sendMsg(msg)
    })

    noita.on("CustomModEvent", (event) => {
        const payload = JSON.stringify(event)
        const msg = encodeGameMsg("cCustomModEvent", { payload })
        sendMsg(msg)
    })

    function sendMsg(msg) {
        if (client != null) {
            client.send(msg)
        }
    }

    appEvent("CONNECTED", data)

    function unready() {
        const msg = encodeLobbyMsg("cReadyState", {
            ready: false,
            seed: "",
            mods: []
        })
        sendMsg(msg)
    }

    function mapWands(wand) {
        return {
            id: uuidv4(),
            stats: keysToCamel(wand.stats),
            alwaysCast: wand.always_cast
                ? wand.always_cast.map(mapSpells)
                : undefined,
            deck: wand.deck.map(mapSpells),
            sentBy: user.userId
        }
    }

    function mapSpells(spell) {
        return {
            id: uuidv4(),
            gameId: spell.id,
            usesRemaining: spell.usesRemaining,
            sentBy: user.userId
        }
    }

    function mapFlasks(val) {
        return {
            id: uuidv4(),
            isChest: val.isChest,
            color: {
                r: (val.color & 0xff) / 193,
                g: ((val.color >> 8) & 0xff) / 193.5,
                b: ((val.color >> 16) & 0xff) / 193
            },
            content: val.content,
            sentBy: user.userId
        }
    }

    function mapObjects(val) {
        return {
            id: uuidv4(),
            path: val.path,
            sprite: val.sprite,
            sentBy: user.userId
        }
    }

    function toCamel(str) {
        return str.replace(/([_][a-z])/gi, ($1) => {
            return $1.toUpperCase().replace("_", "")
        })
    }

    function keysToCamel(obj) {
        const n = {}
        for (const key of Object.keys(obj)) {
            n[toCamel(key)] = obj[key]
        }
        return n
    }
}
