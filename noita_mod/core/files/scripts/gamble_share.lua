-- Sharing the Gamble perk. Gamble spawns an entity that rolls two random perks a few
-- frames later (data/scripts/perks/perk_gamble_spawn.lua). If every game rolled its own,
-- each player would get different perks, so only the player who picked Gamble up rolls,
-- and their two perks are shared as normal team perks. init.lua patches the roll script.
dofile_once("mods/noita-together/files/store.lua")
dofile_once("mods/noita-together/files/scripts/json.lua")
dofile_once("mods/noita-together/files/scripts/ban_perks.lua")

-- Globals are shared by every lua context, so the pickup and the roll script can both see this.
local OWN_GAMBLES = "NT_own_gambles"

-- perk_pickup.lua: this player picked up Gamble while it's shared
function NTGambleCountOwn()
    local n = tonumber(GlobalsGetValue(OWN_GAMBLES, "0")) or 0
    GlobalsSetValue(OWN_GAMBLES, tostring(n + 1))
end

-- the roll script: true if this roll comes from the player's own Gamble (not one shared
-- by someone else, or one picked up while sharing was off)
function NTGambleIsOwn()
    local n = tonumber(GlobalsGetValue(OWN_GAMBLES, "0")) or 0
    if (n <= 0) then return false end
    GlobalsSetValue(OWN_GAMBLES, tostring(n - 1))
    return true
end

function NTGambleSharePerk(perk_id)
    if (perk_id == nil or perk_id == "" or IsBannedPerkId(perk_id)) then return end
    local queue = json.decode(NT.wsQueue)
    table.insert(queue, { event = "CustomModEvent", payload = { name = "TeamPerk", id = perk_id } })
    NT.wsQueue = json.encode(queue)
end
