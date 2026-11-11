"use strict"
// Fake players for testing a room alone (one PC, one Steam account).
//
// Start the app with the environment variable NT_DEV_BOTS=1 and host a room.
// Then type "/bot help" in the room chat (in the app or in game). Bots join
// your room as if they were other players: everything they send goes through
// the same room code, including "Filter invalid data", and you see the result
// in the app and in Noita.
const { v4: uuidv4 } = require("uuid")

const ENV_VAR = "NT_DEV_BOTS"
const PREFIX = "/bot"
// the game shows hp * 25
const HP_SCALE = 25

const HELP = [
    "/bot add [name]: a new bot joins, and later commands go to it",
    "/bot remove [number|all], /bot list, /bot use <number>",
    "/bot ready | unready: copies your seed and mods, so there's no mismatch warning",
    "/bot say <text>",
    "/bot follow | stay: the bot walks next to you during a run",
    "/bot gold <n>: the bot gains n gold (negative to spend). Shared when Shared Gold is on",
    "/bot hurt <hp> | heal <hp> | maxhp <hp>: in the hp the game shows. Shared when shared health is on",
    "/bot status: each bot's gold and hp",
    "/bot perk <PERK_ID>: shares a team perk",
    "/bot spell <SPELL_ID>: puts a spell in the bank",
    "/bot die | win",
    "/bot bad <kind>: sends invalid data (spam, chatspam, longchat, spell, item, wand, flask, gold, hp, perk, banned, join or all)"
]

const BAD = {
    spam: (b) => {
        for (let i = 0; i < 150; i++) b.game("cPlayerMove", b.frames())
    },
    chatspam: (b) => {
        for (let i = 0; i < 12; i++) b.game("cChat", { message: `spam ${i + 1}` })
    },
    longchat: (b) => b.game("cChat", { message: "a".repeat(600) }),
    spell: (b) => b.deposit({ spells: { list: [b.spell("NOT_A_REAL_SPELL")] } }),
    item: (b) => b.deposit({ objects: { list: [{ id: uuidv4(), path: "data/entities/animals/boss_centipede/boss_centipede.xml" }] } }),
    wand: (b) => b.deposit({ wands: { list: [{ id: uuidv4(), stats: { manaMax: Infinity, deckCapacity: 5 }, deck: [], alwaysCast: [] }] } }),
    flask: (b) => b.deposit({ flasks: { list: [{ id: uuidv4(), isChest: false, color: 0, content: [{ id: 1, amount: 1000000000 }] }] } }),
    gold: (b) => b.mod({ name: "SharedGold", delta: 1e12 }),
    hp: (b) => b.mod({ name: "SharedHealth", delta: 0, max: 0 }),
    perk: (b) => b.mod({ name: "TeamPerk", id: "NOT_A_REAL_PERK" }),
    banned: (b) => {
        const id = b.bots.room.bannedPerks()[0]
        if (!id) return "Ban a perk in Game Options first."
        b.mod({ name: "TeamPerk", id })
    },
    join: (b) => {
        // someone outside the room guessing the password
        const id = `${b.id}-guesser`
        for (let i = 0; i < 8; i++) b.bots.room.handleMessage(id, `${b.name}'s guesser`, b.bots.env("lobbyAction", "cJoinRoom", { id: b.bots.room.id, password: `guess${i}` }))
    }
}
// commands that act on a bot
const BOT_COMMANDS = new Set(["ready", "unready", "say", "follow", "stay", "gold", "hurt", "heal", "maxhp", "status", "perk", "spell", "die", "win", "bad"])

BAD.all = (b) => {
    for (const k of ["longchat", "spell", "item", "wand", "flask", "gold", "hp", "perk"]) BAD[k](b)
}

class Bot {
    constructor(bots, n, name) {
        this.bots = bots
        this.n = n
        this.id = `devbot-${n}`
        this.name = name
        // a bot's own wallet and health, kept like the mod's shared_pools.lua does
        this.gold = 0
        this.hp = 4
        this.maxHp = 4
        this.goldSynced = false
        this.healthSynced = false
        this.following = false
    }

    /** Shared Gold / shared health events from the others, applied like the mod does. */
    onModEvent(data) {
        if (!data || typeof data !== "object") return
        if (data.name === "SharedGold" && this.bots.goldActive()) {
            const total = Number(data.total)
            if (data.total !== undefined && Number.isFinite(total)) this.gold = Math.max(this.gold, Math.floor(total))
            else if (Number.isFinite(Number(data.delta))) this.gold = Math.max(0, this.gold + Number(data.delta))
        } else if (data.name === "SharedHealth" && this.bots.healthActive()) {
            const before = [this.hp, this.maxHp]
            const sharedMax = this.bots.sharedMaxHp()
            if (data.sync) {
                if (sharedMax && Number(data.max) > this.maxHp) this.maxHp = Number(data.max)
                if (Number(data.hp) > this.hp) this.hp = Math.min(this.maxHp, Number(data.hp))
            } else {
                if (sharedMax && Number(data.max) > 0) {
                    this.maxHp = Number(data.max)
                    this.hp = Math.min(this.hp, this.maxHp)
                }
                const d = Number(data.delta) || 0
                // someone else's damage stops at 1 hp
                if (d < 0) this.hp = Math.max(this.hp + d, Math.min(this.hp, 0.04))
                else if (d > 0) this.hp = Math.min(this.maxHp, this.hp + d)
            }
            if (before[0] !== this.hp || before[1] !== this.maxHp) this.updateHp()
        }
    }

    /** When Shared Gold or shared health turns on (or the run starts with it on), send our totals once. */
    syncPools() {
        const goldOn = this.bots.goldActive()
        if (goldOn && !this.goldSynced) this.mod({ name: "SharedGold", delta: 0, total: this.gold })
        this.goldSynced = goldOn
        const healthOn = this.bots.healthActive()
        if (healthOn && !this.healthSynced) {
            this.mod({ name: "SharedHealth", delta: 0, sync: true, hp: this.hp, max: this.bots.sharedMaxHp() ? this.maxHp : undefined })
        }
        this.healthSynced = healthOn
    }

    status() {
        return `${this.name}: ${this.gold} gold, ${Math.round(this.hp * HP_SCALE)}/${Math.round(this.maxHp * HP_SCALE)} hp`
    }
    get room() {
        return this.bots.room
    }
    inRoom() {
        const u = this.room.users.get(this.id)
        return !!(u && u.connected)
    }
    lobby(key, payload) {
        this.room.handleMessage(this.id, this.name, this.bots.env("lobbyAction", key, payload))
    }
    game(key, payload) {
        this.room.handleMessage(this.id, this.name, this.bots.env("gameAction", key, payload))
    }
    mod(data) {
        this.game("cCustomModEvent", { payload: JSON.stringify(data) })
    }
    deposit(item) {
        this.game("cPlayerAddItem", item)
    }
    spell(gameId) {
        return { id: uuidv4(), gameId, usesRemaining: -1 }
    }
    frames(from) {
        const f = from ? Object.assign({}, from) : { xInit: 0, yInit: 0, xDeltas: [], yDeltas: [], armR: [], armScaleY: 0, scaleX: 0, animIdx: [], animVal: [], heldIdx: [], heldVal: [] }
        if (from) f.xInit = (from.xInit || 0) + 24 * this.n
        return f
    }
    updateHp() {
        // like the mod: player updates carry the hp the game shows
        this.game("cPlayerUpdate", { curHp: this.hp * HP_SCALE, maxHp: this.maxHp * HP_SCALE })
    }
}

class DevBots {
    static enabled() {
        return !!process.env[ENV_VAR] && process.env[ENV_VAR] !== "0"
    }

    /** @param {import("./hostRoom").HostRoom} room */
    constructor(room, { NT, chat }) {
        this.room = room
        this.NT = NT
        this.chat = chat
        /** @type {Bot[]} */
        this.bots = []
        this.current = null
        this.count = 0
    }

    env(kind, key, payload) {
        // encode and decode, so bots send exactly what a real player's message turns into
        return this.NT.Envelope.decode(this.NT.Envelope.encode({ [kind]: { [key]: payload } }).finish())
    }

    has(userId) {
        return this.bots.some((b) => b.id === userId) || /^devbot-\d+-guesser$/.test(userId)
    }

    /** Messages the room sends to a bot. */
    receive(userId, msg) {
        const bot = this.bots.find((b) => b.id === userId)
        if (!bot) return
        let env
        try {
            env = this.NT.Envelope.decode(msg)
        } catch (e) {
            return
        }
        const ev = env.gameAction && env.gameAction.sCustomModEvent
        if (ev && ev.userId !== bot.id) {
            try {
                bot.onModEvent(JSON.parse(ev.payload))
            } catch (e) {
                // not JSON: some other mod's event
            }
        }
        // options or the run may have changed. React after the room has finished
        // sending this message to everyone, like a real player over the network would.
        if (!this.syncQueued) {
            this.syncQueued = true
            setImmediate(() => {
                this.syncQueued = false
                if (!this.room.destroyed) for (const b of this.alive()) b.syncPools()
            })
        }
    }

    goldActive() {
        return this.room.inProgress && this.room.hasFlag("NT_shared_gold")
    }

    sharedMaxHp() {
        const f = this.room.flags.find((x) => x.flag === "NT_death_penalty")
        return !!(f && f.strVal === "shared_health")
    }

    healthActive() {
        return this.room.inProgress && (this.sharedMaxHp() || this.room.hasFlag("NT_shared_health"))
    }

    reply(lines) {
        for (const line of [].concat(lines)) this.chat(`[Bots] ${line}`)
    }

    /** The room owner moved; bots that follow walk next to them. */
    ownerMoved(frames) {
        for (const b of this.alive()) if (b.following) b.game("cPlayerMove", b.frames(frames))
    }

    alive() {
        // kicked, banned or left bots are gone
        this.bots = this.bots.filter((b) => this.room.users.has(b.id))
        if (this.current && !this.bots.includes(this.current)) this.current = this.bots[this.bots.length - 1] || null
        return this.bots
    }

    /** @returns {boolean} true if `message` was a bot command */
    command(message) {
        if (message.toLowerCase() !== PREFIX && !message.toLowerCase().startsWith(PREFIX + " ")) return false
        const args = message.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean)
        const cmd = (args.shift() || "help").toLowerCase()
        try {
            const out = this.run(cmd, args)
            if (out) this.reply(out)
        } catch (e) {
            this.reply(`That didn't work: ${e.message}`)
        }
        return true
    }

    run(cmd, args) {
        const rest = args.join(" ")
        const num = (s) => {
            const n = Number(s)
            if (!Number.isFinite(n)) throw new Error(`"${s || ""}" isn't a number`)
            return n
        }
        if (cmd === "help") return HELP
        if (cmd === "add") return this.add(rest)
        if (cmd === "list") {
            const bots = this.alive()
            if (!bots.length) return "No bots. Add one with /bot add"
            return bots.map((b) => `${b.n}: ${b.name}${b === this.current ? " (commands go here)" : ""}${b.inRoom() ? "" : " (not connected)"}`)
        }
        if (cmd === "remove") {
            const which = rest.toLowerCase() === "all" ? this.alive().slice() : [this.pick(args[0])]
            for (const b of which) b.lobby("cLeaveRoom", { userId: b.id })
            this.alive()
            return null // the room already says who left
        }
        if (cmd === "use") {
            this.current = this.pick(args[0])
            return `Commands now go to ${this.current.name}.`
        }

        if (!BOT_COMMANDS.has(cmd)) throw new Error(`unknown command "${cmd}". Type /bot help`)
        const b = this.pick()
        const ownerState = this.room.owner.readyState || {}
        switch (cmd) {
            case "ready":
            case "unready":
                b.lobby("cReadyState", {
                    ready: cmd === "ready",
                    seed: ownerState.seed || "",
                    mods: ownerState.mods || [],
                    version: ownerState.version || "",
                    beta: !!ownerState.beta
                })
                return null
            case "say":
                b.game("cChat", { message: rest || "hello" })
                return null
            case "follow":
            case "stay":
                b.following = cmd === "follow"
                return b.following ? `${b.name} follows you during a run (the game has to be running).` : `${b.name} stays put.`
            case "gold": {
                // the bot's own wallet; shared only while Shared Gold is on during a run
                const before = b.gold
                b.gold = Math.max(0, b.gold + Math.round(num(args[0])))
                const change = b.gold - before
                if (this.goldActive()) {
                    if (change !== 0) b.mod({ name: "SharedGold", delta: change })
                    return `${b.name} changed the team's gold by ${change}. ${b.status()}`
                }
                return `${b.status()}. ${this.poolHint(this.room.hasFlag("NT_shared_gold"), "Shared Gold", "the team takes the richest wallet")}`
            }
            case "hurt":
            case "heal": {
                const d = (num(args[0]) / HP_SCALE) * (cmd === "hurt" ? -1 : 1)
                const before = b.hp
                b.hp = Math.max(0, Math.min(b.maxHp, b.hp + d))
                if (this.healthActive() && b.hp !== before) b.mod({ name: "SharedHealth", delta: b.hp - before })
                b.updateHp()
                if (this.healthActive()) return `${b.name} ${cmd === "hurt" ? "took" : "healed"} ${Math.abs(num(args[0]))} hp. ${b.status()}`
                return `${b.status()}. ${this.poolHint(this.sharedMaxHp(), 'The "Shared health (ends run)" death penalty', "the team takes the highest health")}`
            }
            case "maxhp": {
                const max = num(args[0]) / HP_SCALE
                if (!(max > 0)) throw new Error("max hp has to be above 0")
                b.maxHp = max
                b.hp = Math.min(b.hp, max)
                if (this.healthActive()) b.mod({ name: "SharedHealth", delta: 0, max: this.sharedMaxHp() ? max : undefined })
                b.updateHp()
                if (this.healthActive()) return `${b.name} set max hp to ${num(args[0])}. ${b.status()}`
                return `${b.status()}. ${this.poolHint(this.sharedMaxHp(), 'The "Shared health (ends run)" death penalty', "the team takes the highest health")}`
            }
            case "status":
                return this.alive().map((x) => x.status())
            case "perk":
                if (!args[0]) throw new Error("which perk? For example /bot perk EXTRA_HP")
                b.mod({ name: "TeamPerk", id: args[0].toUpperCase() })
                return `${b.name} shared ${args[0].toUpperCase()}. Team Perks or Share all perks has to be on, and the run started.`
            case "spell":
                if (!args[0]) throw new Error("which spell? For example /bot spell LIGHT_BULLET")
                b.deposit({ spells: { list: [b.spell(args[0].toUpperCase())] } })
                return `${b.name} put ${args[0].toUpperCase()} in the bank (only during a run).`
            case "die":
            case "win":
                b.game("cPlayerDeath", { isWin: cmd === "win", gameTime: 60 })
                return null
            case "bad": {
                const kind = (args[0] || "").toLowerCase()
                if (!BAD[kind]) throw new Error(`pick one of: ${Object.keys(BAD).join(", ")}`)
                const out = BAD[kind](b)
                if (out) return out
                return this.room.hasFlag("NT_filter_invalid_data")
                    ? `${b.name} sent invalid data (${kind}).`
                    : `${b.name} sent invalid data (${kind}). "Filter invalid data" is off, so it went through.`
            }
        }
        return null
    }

    add(name) {
        this.count++
        const bot = new Bot(this, this.count, (name || `Bot ${this.count}`).slice(0, 30))
        this.bots.push(bot)
        bot.lobby("cJoinRoom", { id: this.room.id, password: this.room.password || "" })
        if (!bot.inRoom()) {
            this.bots.pop()
            return `${bot.name} couldn't join (the room may be full or locked).`
        }
        this.current = bot
        if (this.room.inProgress) bot.updateHp()
        return null // the room already says who joined
    }

    pick(n) {
        const bots = this.alive()
        if (!bots.length) throw new Error("no bots yet. Add one with /bot add")
        if (n === undefined) return this.current || bots[bots.length - 1]
        const b = bots.find((x) => String(x.n) === String(n))
        if (!b) throw new Error(`no bot number ${n}. See /bot list`)
        return b
    }

    /** Why a gold/health change stayed with the bot. */
    poolHint(optionOn, option, onSync) {
        if (!optionOn) return `${option} is off, so only the bot has it. When it's turned on during a run, ${onSync}.`
        return `The run hasn't started, so only the bot has it. When it starts, ${onSync}.`
    }
}

module.exports = { DevBots, ENV_VAR }
