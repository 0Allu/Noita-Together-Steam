// Tells the mod the room's world seed before the game starts a new run.
//
// The mod can only set the world seed while a new game is being created
// (OnModPreInit), before it connects to the app. Without this file it only learns
// the room's seed after connecting, so the first New Game used the previous seed
// and the mod had to end it ("Host changed world seed"). The mod reads
// mods/noita-together/nt_room_seed.txt in OnModPreInit (noita_mod/core/init.lua).
// 0 means "no room seed". A second number, when there is one, is this player's
// starting loadout shift for "Different starting loadouts" (older mods ignore it).
const fs = require("fs")
const path = require("path")

const FILE = "nt_room_seed.txt"
let lastWritten = null

/** The game folder the mod updater found or the player picked (src/updater.js). */
function gameFolder() {
    try {
        const { app } = require("electron")
        const file = path.join(app.getPath("userData"), "gamePath.json")
        const folder = JSON.parse(fs.readFileSync(file, "utf-8"))
        return typeof folder === "string" ? folder.trim() : ""
    } catch (e) {
        return ""
    }
}

/**
 * A number from 1 to 999983 that's (nearly always) different for every player, so
 * each one rolls their own starting items on the shared seed.
 * @param {string|number} userId
 */
function loadoutShift(userId) {
    let h = 0x811c9dc5 // FNV-1a
    for (const c of String(userId)) {
        h ^= c.charCodeAt(0)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return (h % 999983) + 1
}

const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * @param {number} seed the room's world seed, or 0 for none
 * @param {number} [loadout] this player's loadout shift, or 0 for the usual items
 * @param {string} [folder] the game folder (tests)
 */
function writeRoomSeed(seed, loadout, folder) {
    const value = whole(seed)
    const shift = value ? whole(loadout) : 0
    const text = shift ? `${value} ${shift}` : String(value)
    if (text === lastWritten && !folder) return
    const modDir = path.join(folder || gameFolder(), "mods", "noita-together")
    if (!fs.existsSync(modDir)) return
    try {
        fs.writeFileSync(path.join(modDir, FILE), text)
        lastWritten = text
    } catch (e) {
        console.error("[seed] could not write the room seed for the mod", e)
    }
}

module.exports = { writeRoomSeed, loadoutShift, FILE }
