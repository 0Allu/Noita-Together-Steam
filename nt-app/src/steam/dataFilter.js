// "Filter invalid data" room option (NT_filter_invalid_data).
//
// Every message goes through the host, so the host can drop messages that no
// unmodified game would send before anyone else receives them: floods, oversized
// chat, bank items that don't exist, impossible numbers. It can't see what happens
// inside another player's game, so it doesn't stop cheats like god mode; it only
// keeps bad data from reaching everyone else.
const fs = require("fs")
const path = require("path")

const LIMITS = {
    // per player; normal play sends about 10 a second (moves, health and gold syncs)
    messagesPerSecond: 40,
    messageBurst: 80,
    chatLength: 500,
    // [messages, per milliseconds] for message kinds with their own limit
    windows: {
        cChat: [8, 10000],
        // join attempts, which is also how many passwords someone can try
        cJoinRoom: [5, 30000]
    },
    itemsPerDeposit: 100,
    spellsPerWand: 1000,
    flaskAmount: 100000,
    gold: 100000000,
    // 1 to 2.5 million hp on screen (the game shows hp * 25)
    minMaxHp: 0.04,
    maxMaxHp: 100000,
    customEventBytes: 65536,
    readyMods: 500,
    textLength: 200
}

/** What the host's own game reported, plus the bundled mod's item list. */
const gameData = {
    /** @type {Set<string>|null} spell ids (GameSpellList from the host's game) */
    spells: null,
    /** @type {Set<string>|null} perk ids (GamePerkList from the host's game) */
    perks: null,
    /** @type {Set<string>|null|undefined} bank object paths, read from the mod once */
    objects: undefined,
    setSpells(ids) {
        if (Array.isArray(ids) && ids.length) this.spells = new Set(ids.map(String))
    },
    setPerks(ids) {
        if (Array.isArray(ids) && ids.length) this.perks = new Set(ids.map(String))
    },
    getObjects() {
        if (this.objects === undefined) this.objects = loadObjectPaths()
        return this.objects
    }
}

/** The keys of nt_items in the bundled mod's item_list.lua: the pickups the bank accepts. */
function loadObjectPaths(file) {
    const candidates = file ? [file] : []
    if (!file && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, "noita_mod", "core", "files", "scripts", "item_list.lua"))
    }
    for (const f of candidates) {
        try {
            const src = fs.readFileSync(f, "utf8")
            const paths = new Set()
            const re = /\[\s*"([^"]+\.xml)"\s*\]\s*=/g
            let m
            while ((m = re.exec(src))) paths.add(m[1])
            if (paths.size) return paths
        } catch (e) {
            // not packaged (development): skip the object check
        }
    }
    return null
}

// messages with a check below (looked up by name, so only these)
const CHECKED = new Set([
    "cChat", "cReadyState", "cPlayerUpdate", "cPlayerAddGold", "cPlayerTakeGold", "cPlayerAddItem", "cCustomModEvent"
])

const finite = (n) => typeof n === "number" && Number.isFinite(n)
const tooLong = (s, max) => typeof s === "string" && s.length > max

class DataFilter {
    constructor(data = gameData, limits = LIMITS) {
        this.data = data
        this.limits = limits
        /** @type {Map<string, {tokens: number, last: number, chat: number[]}>} */
        this.rates = new Map()
    }

    forget(userId) {
        this.rates.delete(userId)
    }

    /**
     * @param {string} userId
     * @param {string} key message name, e.g. "cChat"
     * @param {object} payload decoded message
     * @param {{bannedPerks?: string[], now?: number}} [room]
     * @returns {string|null} why the message was dropped, or null to let it through
     */
    check(userId, key, payload, room = {}) {
        const now = room.now !== undefined ? room.now : Date.now()
        const flood = this.rate(userId, key, now)
        if (flood) return flood
        if (!CHECKED.has(key)) return null
        const fn = this[key]
        try {
            return fn.call(this, payload || {}, room) || null
        } catch (e) {
            return "sent a message that couldn't be read"
        }
    }

    rate(userId, key, now) {
        let r = this.rates.get(userId)
        if (!r) {
            r = { tokens: this.limits.messageBurst, last: now, windows: {} }
            this.rates.set(userId, r)
        }
        r.tokens = Math.min(this.limits.messageBurst, r.tokens + ((now - r.last) / 1000) * this.limits.messagesPerSecond)
        r.last = now
        if (r.tokens < 1) return "is sending too many messages"
        r.tokens -= 1
        const win = this.limits.windows[key]
        if (win) {
            const [max, ms] = win
            const times = (r.windows[key] || []).filter((t) => now - t < ms)
            r.windows[key] = times
            if (times.length >= max) return key === "cChat" ? "is sending chat messages too fast" : "is trying to join too often"
            times.push(now)
        }
        return null
    }

    //// one method per message name ////

    cChat(p) {
        if (tooLong(p.message, this.limits.chatLength)) return "sent a chat message that's too long"
    }

    cReadyState(p) {
        const mods = p.mods || []
        if (mods.length > this.limits.readyMods || mods.some((m) => tooLong(m, this.limits.textLength))) {
            return "sent an impossible mod list"
        }
        if (tooLong(p.seed, this.limits.textLength) || tooLong(p.version, this.limits.textLength)) {
            return "sent an impossible seed or version"
        }
    }

    cPlayerUpdate(p) {
        for (const k of ["curHp", "maxHp"]) {
            if (p[k] !== undefined && p[k] !== null && !finite(p[k])) return "sent impossible health"
        }
        if (tooLong(p.location, this.limits.textLength)) return "sent an impossible location"
    }

    cPlayerAddGold(p) {
        if (!finite(p.amount) || p.amount > this.limits.gold) return "deposited an impossible amount of gold"
    }

    cPlayerTakeGold(p) {
        if (!finite(p.amount) || p.amount > this.limits.gold) return "asked for an impossible amount of gold"
    }

    cPlayerAddItem(p) {
        const lists = ["spells", "wands", "flasks", "objects"].filter((k) => p[k])
        for (const k of lists) {
            const list = p[k].list || []
            if (list.length > this.limits.itemsPerDeposit) return "deposited too many items at once"
        }
        if (p.objects) {
            const known = this.data.getObjects()
            for (const o of p.objects.list || []) {
                if (known && !known.has(o.path)) return `deposited an item that can't be banked (${clip(o.path)})`
            }
        }
        if (p.spells) {
            for (const s of p.spells.list || []) {
                const bad = this.badSpell(s)
                if (bad) return `deposited ${bad}`
            }
        }
        if (p.wands) {
            for (const w of p.wands.list || []) {
                const bad = this.badWand(w)
                if (bad) return `deposited ${bad}`
            }
        }
        if (p.flasks) {
            for (const f of p.flasks.list || []) {
                let total = 0
                for (const m of f.content || []) total += finite(m.amount) ? m.amount : Infinity
                if (!(total <= this.limits.flaskAmount)) return "deposited a flask with an impossible amount in it"
            }
        }
    }

    badSpell(s) {
        if (!s || typeof s.gameId !== "string" || !s.gameId) return "a spell with no id"
        if (this.data.spells && !this.data.spells.has(s.gameId)) return `a spell that doesn't exist (${clip(s.gameId)})`
        return null
    }

    badWand(w) {
        const st = w.stats || {}
        for (const k of ["manaMax", "manaChargeSpeed", "reloadTime", "actionsPerRound", "deckCapacity",
            "spreadDegrees", "speedMultiplier", "fireRateWait", "tipX", "tipY", "gripX", "gripY"]) {
            if (st[k] !== undefined && !finite(st[k])) return "a wand with impossible stats"
        }
        const spells = (w.deck || []).concat(w.alwaysCast || [])
        if (spells.length > this.limits.spellsPerWand) return "a wand with too many spells"
        for (const s of spells) {
            const bad = this.badSpell(s)
            if (bad) return `a wand with ${bad}`
        }
        return null
    }

    cCustomModEvent(p, room) {
        const raw = p.payload
        if (typeof raw !== "string") return null
        if (raw.length > this.limits.customEventBytes) return "sent a mod event that's too large"
        let data
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return null // other mods' events are their own business
        }
        if (!data || typeof data !== "object") return null
        switch (data.name) {
            case "SharedGold":
                if (!finite(data.delta) || Math.abs(data.delta) > this.limits.gold) return "sent an impossible shared gold change"
                // total: their gold when Shared Gold was turned on
                if (data.total !== undefined && (!finite(data.total) || data.total < 0 || data.total > this.limits.gold)) {
                    return "sent an impossible amount of shared gold"
                }
                break
            case "SharedHealth":
                if (!finite(data.delta)) return "sent an impossible shared health change"
                if (data.max !== undefined && data.max !== null &&
                    (!finite(data.max) || data.max < this.limits.minMaxHp || data.max > this.limits.maxMaxHp)) {
                    return "sent an impossible max health"
                }
                // hp: their health when shared health was turned on
                if (data.hp !== undefined && (!finite(data.hp) || data.hp < 0 || data.hp > this.limits.maxMaxHp)) {
                    return "sent impossible shared health"
                }
                break
            case "DeathCause":
                if (tooLong(data.cause, this.limits.textLength)) return "sent a cause of death that's too long"
                break
            case "TeamPerk": {
                const id = String(data.id || "")
                if (this.data.perks && !this.data.perks.has(id)) return `shared a perk that doesn't exist (${clip(id)})`
                if ((room.bannedPerks || []).includes(id)) return `shared a banned perk (${clip(id)})`
                break
            }
        }
        return null
    }
}

function clip(s) {
    s = String(s)
    return s.length > 60 ? s.slice(0, 57) + "..." : s
}

module.exports = { DataFilter, gameData, loadObjectPaths, LIMITS }
