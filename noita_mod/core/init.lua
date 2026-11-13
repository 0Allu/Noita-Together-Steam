--enable logger (allow opt out in settings)
--do it first so it logs other errors in init?
if(ModSettingGet("noita-together.NT_ENABLE_LOGGER")) then
    ModMagicNumbersFileAdd("mods/noita-together/files/magic_numbers/enable_logger.xml")
end

---------------------------
-- lua dofile "includes" --
---------------------------
if not async then
    dofile("mods/noita-together/files/scripts/coroutines.lua")
end 
dofile_once("mods/noita-together/files/scripts/utils.lua")
dofile_once("mods/noita-together/files/scripts/ui.lua")
dofile_once("mods/noita-together/files/scripts/shared_pools.lua")

-----------------
-- lua appends --
-----------------
local pregen_wand_biomes = {
    "data/scripts/biomes/coalmine.lua",
    "data/scripts/biomes/coalmine_alt.lua",
    "data/scripts/biomes/tower.lua",
};
for _,entry in pairs( pregen_wand_biomes ) do
    ModLuaFileAppend( entry, "mods/noita-together/files/append/preset_wands_random.lua" );
end
ModLuaFileAppend("data/scripts/biome_scripts.lua", "mods/noita-together/files/append/biome_scripts.lua")
ModLuaFileAppend("data/scripts/items/generate_shop_item.lua", "mods/noita-together/files/append/generate_shop_item.lua")
ModLuaFileAppend("data/scripts/gun/procedural/gun_procedural.lua", "mods/noita-together/files/append/gun_procedural.lua")
ModLuaFileAppend("data/scripts/items/chest_random.lua", "mods/noita-together/files/append/chest_random.lua")
ModLuaFileAppend("data/scripts/items/chest_random_super.lua", "mods/noita-together/files/append/chest_random_super.lua")

ModLuaFileAppend("data/scripts/biomes/temple_altar.lua", "mods/noita-together/files/append/co_op_mail.lua")
ModLuaFileAppend("data/scripts/biomes/boss_arena.lua", "mods/noita-together/files/append/co_op_mail.lua")
ModLuaFileAppend("data/scripts/biomes/boss_arena.lua", "mods/noita-together/files/append/boss_arena.lua")

ModLuaFileAppend("data/scripts/biomes/snowcastle_cavern.lua", "mods/noita-together/files/append/snowcastle_cavern.lua")
ModLuaFileAppend("data/scripts/biomes/snowcastle_hourglass_chamber.lua", "mods/noita-together/files/append/butcher_randomseed.lua")
ModLuaFileAppend("data/entities/animals/boss_centipede/sampo_pickup.lua", "mods/noita-together/files/append/sampo_append.lua")
ModLuaFileAppend("data/scripts/items/heart.lua", "mods/noita-together/files/append/heart_append.lua")
ModLuaFileAppend("data/scripts/items/heart_better.lua", "mods/noita-together/files/append/heart_better_append.lua")
ModLuaFileAppend("data/scripts/items/orb_init.lua", "mods/noita-together/files/append/orb_init.lua")
ModLuaFileAppend("data/scripts/items/orb_pickup.lua", "mods/noita-together/files/append/orb_pickup.lua")
ModLuaFileAppend("data/scripts/perks/perk_pickup.lua", "mods/noita-together/files/append/perk_pickup.lua")
ModLuaFileAppend("data/scripts/perks/perk_reroll.lua", "mods/noita-together/files/append/perk_reroll.lua")
ModLuaFileAppend("data/scripts/perks/perk.lua", "mods/noita-together/files/append/perk.lua")
ModLuaFileAppend("data/scripts/magic/fungal_shift.lua", "mods/noita-together/files/append/fungal_shift.lua")

ModTextFileSetContent("data/scripts/status_effects/hearty_end.lua",ModTextFileGetContent("mods/noita-together/files/append/status_effects/hearty_end.lua"))
ModTextFileSetContent("data/scripts/status_effects/hearty_start.lua",ModTextFileGetContent("mods/noita-together/files/append/status_effects/hearty_start.lua"))

-- "Different starting loadouts": the starting wand, bomb wand and potion seed their
-- rolls from the spawn position, so on a shared world seed everyone starts with the
-- same items. Each script gets its own SetRandomSeed that shifts x by this player's
-- number from the app (noita_together.loadout, set in OnModPreInit; 0 = unchanged).
local LOADOUT_SCRIPTS = {
    "data/scripts/gun/procedural/starting_wand.lua",
    "data/scripts/gun/procedural/starting_bomb_wand.lua",
    "data/scripts/items/potion_starting.lua",
}
local LOADOUT_PREFIX = "-- noita-together loadout\n" ..
    "local __nt_SetRandomSeed = SetRandomSeed\n" ..
    "local __nt_loadout = tonumber(ModSettingGet(\"noita_together.loadout\")) or 0\n" ..
    "local function SetRandomSeed(x, y) return __nt_SetRandomSeed(x + __nt_loadout, y) end\n"
for _, file in ipairs(LOADOUT_SCRIPTS) do
    local ok, text = pcall(ModTextFileGetContent, file)
    if ok and type(text) == "string" and text ~= "" and text:find("noita-together loadout", 1, true) == nil then
        ModTextFileSetContent(file, LOADOUT_PREFIX .. text)
    end
end

-- Gamble rolls its two perks with perk_pickup directly, so the perk_pickup.lua append
-- never sees them. With "share all perks" on, send the perks this player's own Gamble
-- rolled (files/scripts/gamble_share.lua), so everyone gets the same two.
local GAMBLE_SCRIPT = "data/scripts/perks/perk_gamble_spawn.lua"
local GAMBLE_PICKUP = 'perk_pickup(pid, player, "", false, false )'
do
    local ok, text = pcall(ModTextFileGetContent, GAMBLE_SCRIPT)
    if ok and type(text) == "string" and text:find("noita-together gamble", 1, true) == nil then
        local at = text:find(GAMBLE_PICKUP, 1, true)
        if at ~= nil then
            local stop = at + #GAMBLE_PICKUP
            text = "-- noita-together gamble\n" ..
                "dofile_once(\"mods/noita-together/files/scripts/gamble_share.lua\")\n" ..
                "local __nt_share_gamble = NTGambleIsOwn()\n" ..
                text:sub(1, stop - 1) ..
                " if __nt_share_gamble then NTGambleSharePerk(comp.value_string) end" ..
                text:sub(stop)
            ModTextFileSetContent(GAMBLE_SCRIPT, text)
        end
    end
end

--emote system mnee support
if ModIsEnabled("mnee") then
	ModLuaFileAppend("mods/mnee/bindings.lua", "mods/noita-together/files/emotes/scripts/mnee.lua")
end

-----------------------------------------
-- Append our translations to the game --
-----------------------------------------
local TRANSLATIONS_FILE = "data/translations/common.csv"
local translations = ModTextFileGetContent(TRANSLATIONS_FILE) .. ModTextFileGetContent("mods/noita-together/files/translations/translations.csv")
ModTextFileSetContent(TRANSLATIONS_FILE, translations)

--TODO what is all this? can we move it somewhere?
HideGhosts = false
HideChat = false
PlayerRadar = true
BankItems = {}
BankGold = 0
SpellSprites = {}
InGameChat = {}
lastChatMsg = 0
PlayerList = {}
PlayerCount = 1 -- fix this later
GamePaused = false
LastUpdate = {location= "Mountain", curHp = 100, maxHp = 100}
LastLocation = {x = 0, y = 0, scale_x = 0}
loc_counter = 0
Respawning = false
LastRespawn = 0
_start_run = false
_started = false
_Players = {}
function InGameChatAddMsg(data)
    table.insert(InGameChat, data)
    if (#InGameChat > 100) then
        table.remove(InGameChat, 1)
    end
end

function is_valid_entity(entity_id)
    return entity_id ~= nil and entity_id ~= 0
end

--option to disable progress tracking, thanks dextercd for suggestion
function SetProgressDisable(b)
    if b then
        GameAddFlagRun("NT_option_disable_progress")
        GameAddFlagRun("no_progress_flags_perk")
        GameAddFlagRun("no_progress_flags_animal")
        GameAddFlagRun("no_progress_flags_action")
    else
        GameRemoveFlagRun("NT_option_disable_progress")
        GameRemoveFlagRun("no_progress_flags_perk")
        GameRemoveFlagRun("no_progress_flags_animal")
        GameRemoveFlagRun("no_progress_flags_action")
    end
end

function OnWorldPreUpdate()
    --tick UI
    draw_gui()
end

loc_tracker = {}
local anims_n = {
    stand = 1,
    walk = 2,
    run = 3,
    burn = 4,
    jump_up = 5,
    jump_fall = 6,
    land = 7,
    fly_idle = 8,
    fly_move = 9,
    knockback = 10,
    swim_idle = 11,
    swim_move = 12,
    attack = 13,
    kick = 14,
    kick_alt = 15,
    lower_head = 16,
    raise_head = 17,
    eat = 18,
    crouch = 19,
    walk_backwards = 20,
    move_item_stash = 21,
    move_item = 22,
    throw_old = 23,
    stand_crouched = 24,
    walk_crouched = 25,
    run_crouched = 26,
    walk_backwards_crouched = 27,
    kick_crouched = 28,
    kick_alt_crouched = 29,
    throw_crouched = 30,
    rise = 31,
    throw = 32,
    slide = 33,
    slide_end = 34,
    slide_crouched = 35,
    slide_end_crouched = 36,
    slide_start = 37,
    slide_start_crouched = 38,
    hurt = 39,
    hurt_swim = 40,
    hurt_fly = 41,
    grab_item = 42,
    idle_hold = 43,
    throw_item = 44,
    push_start = 45,
    push = 46,
    cough = 47,
    intro_stand_up = 48,
    intro_sleep = 49,
    throw_small = 50,
    telekinesis_grab_start = 51,
    telekinesis_grab_start_crouched = 52,
    telekinesis_throw = 53,
    telekinesis_throw_crouched = 54
}
function OnWorldPostUpdate()
    local world_state = GameGetWorldStateEntity()
    if (GamePaused) then
        GamePaused = false
    end
    IsPlayerDead()
    if (_ws_main and is_valid_entity(world_state)) then
        _ws_main()
        if (NT ~= nil) then
            if (_start_run and not started) then
                StartRun()
            end

            --the host pressed Enter to start the run
            HostStartRunTick()

            --BOSS FIGHT CHECK
            CoopBossFightTick()

            --shared gold / shared health
            SharedPoolsTick()

            --fallback for KillPlayerWithCause
            KillPlayerTick()
        end
        local player = GetPlayer()
        local frame = GameGetFrameNum()
        if (player ~= nil and frame % 2 == 0) then
            local x, y, rot, scale_x = EntityGetTransform(player)
            local spritecomp = EntityGetFirstComponentIncludingDisabled(player, "SpriteComponent", "character")
            local rect_anim = ComponentGetValue2(spritecomp, "rect_animation")
            local anim = anims_n[rect_anim] or 1
            local held = GetWandSlot( player )
            local mov = {
                x=tonumber( string.format("%.2f", x) ),
                y=tonumber( string.format("%.2f", y) ),
                scaleX=scale_x,
                anim=anim,
                held=held
            }
            for _, child in pairs(EntityGetAllChildren(player)) do
                if (EntityGetName(child) == "arm_r") then
                    local ax, ay, ar, asx, asy = EntityGetTransform(child)
                    mov.armR = tonumber( string.format("%.2f", ar) )
                    mov.armScaleY = asy
                    break
                end
            end
            table.insert(loc_tracker, mov)
        end
    end
end

function OnPlayerSpawned(player_entity)
    --[[local init_check_flag = "start_nt_init_done"
	if GameHasFlagRun( init_check_flag ) then
		return
	end
    GameAddFlagRun( init_check_flag )]]
    dofile_once("mods/noita-together/files/store.lua")
    local damage_models = EntityGetFirstComponent(player_entity, "DamageModelComponent")
    if (damage_models ~= nil) then ComponentSetValue2(damage_models, "wait_for_kill_flag_on_death", true) end
    -- remember what hurt the player, for the cause of death
    local has_damage_script = false
    for _, comp in ipairs(EntityGetComponent(player_entity, "LuaComponent") or {}) do
        if ComponentGetValue2(comp, "script_damage_received") == "mods/noita-together/files/scripts/damage_received.lua" then
            has_damage_script = true
        end
    end
    if not has_damage_script then
        EntityAddComponent2(player_entity, "LuaComponent", {
            script_damage_received = "mods/noita-together/files/scripts/damage_received.lua",
            execute_every_n_frame = -1
        })
    end
    local res_x = MagicNumbersGetValue("DESIGN_PLAYER_START_POS_X")
    local res_y = MagicNumbersGetValue("DESIGN_PLAYER_START_POS_Y")
    if (not GameHasFlagRun("NT_respawn_checkpoint_added")) then
		EntityAddComponent2(player_entity, "VariableStorageComponent", {
            name = "respawn_checkpoint",
            value_string = res_x .. "," .. res_y
        })
        GameAddFlagRun("NT_respawn_checkpoint_added")
	end
    
    local controls_component = EntityGetFirstComponent(player_entity, "ControlsComponent")
    if (controls_component ~= nil) then
        ComponentSetValue2(controls_component, "enabled", false)
    end

    --add the emote system entity
    if EntityGetWithName("emotes") == 0 then
        local emote_system = EntityLoad("mods/noita-together/files/emotes/entities/emotes.xml", player_x, player_y)
        EntityAddChild(player_entity, emote_system)
    end

    --Prevent players from polymorphing before the run begins
    --But don't add if we already have poly immunity from some other source (resumed run / reconnect while poly immune?)
    if (not EntityHasTag(player_entity, "polymorphable_NOT")) then
        EntityAddTag(player_entity, "polymorphable_NOT")
        GameAddFlagRun("NT_added_poly_immune_prerun")

        --also disable drinking the starting potion
        --we will reenable this later ( utils.lua:StartRun() )
        SetStarterPotionDrinkable(false)
    end

    if (ModSettingGet("noita-together.NT_HINTS")) then
        EntityLoad("mods/noita-together/files/entities/start_run_hint.xml", res_x - 45, res_y + 30)
    end

    --option to disable progress tracking, thanks dextercd for suggestion
    if (ModSettingGet("noita-together.NT_NO_STAT_PROGRESS") and not GameHasFlagRun("no_progress_flags_perk")) then
        --nt print_error("Adding no_progress flags, option enabled and flags dont exist already")
        SetProgressDisable(true)
    end
end

function OnPausePreUpdate()
    if (not GamePaused) then
        GamePaused = true
        SendWsEvent({event="paused", payload = {}})
    end
    if (_ws_main) then
        _ws_main()
    end
end

function OnModInit()
    --[[
    if (GameIsBetaBuild()) then
        local action = ModTextFileGetContent("data/entities/misc/custom_cards/action.xml")
        ModTextFileSetContent("data/entities/misc/custom_cards/action.xml", string.gsub(action, "<Entity>", "<Entity tags=\"card_action\">"))
    end
    ]]
    _G._ModTextFileGetContent = ModTextFileGetContent
end

-- The app writes the room's world seed to this file as soon as it knows it, so the
-- first New Game already uses it. Without the file (or without io), the seed only
-- arrives once the game connects to the app, which is after the world was made.
local ROOM_SEED_FILE = "mods/noita-together/nt_room_seed.txt"

local function parse_seed(text)
    local seed = tonumber((text or ""):match("^%s*(%d+)"))
    if seed ~= nil and seed >= 0 then return math.floor(seed) end
    return nil
end

-- the second number, if any: this player's starting loadout shift (0 = none)
local function parse_loadout(text)
    local n = tonumber((text or ""):match("^%s*%d+%s+(%d+)"))
    if n ~= nil and n > 0 then return math.floor(n) end
    return 0
end

-- returns the seed, how it was read (for the log) and the loadout shift,
-- or nil and why not
local function room_seed_from_app()
    -- straight from disk: always the current file
    if io ~= nil and io.open ~= nil then
        local ok, text = pcall(function()
            local f = io.open(ROOM_SEED_FILE, "r")
            if f == nil then return nil end
            local t = f:read("*a")
            f:close()
            return t
        end)
        local seed = ok and parse_seed(text) or nil
        if seed ~= nil then return seed, "io", parse_loadout(text) end
    end
    -- through Noita's own file access, in case io isn't available here
    local get = ModTextFileGetContent or _G._ModTextFileGetContent
    if get ~= nil then
        local ok, text = pcall(get, ROOM_SEED_FILE)
        local seed = ok and parse_seed(text) or nil
        if seed ~= nil then return seed, "ModTextFileGetContent", parse_loadout(text) end
    end
    return nil, (io == nil and "no io, " or "") .. "no readable " .. ROOM_SEED_FILE
end

function OnModPreInit()
    local seed, how, loadout = room_seed_from_app()
    -- only from the app's current file; never left over from an earlier room
    ModSettingSet( "noita_together.loadout", loadout or 0 )
    if (seed ~= nil) then
        print("[NT] world seed from the app: " .. tostring(seed) .. " (" .. how .. "), loadout " .. tostring(loadout))
        ModSettingSet( "noita_together.seed", seed )
    else
        seed = ModSettingGet( "noita_together.seed" )
        print("[NT] no world seed from the app (" .. tostring(how) .. "), using the last one: " .. tostring(seed))
    end

    if (seed == nil) then
        seed = 0
        ModSettingSet( "noita_together.seed", seed )
    end

    if (seed > 0) then
        SetWorldSeed(seed)
    end
end

function OnWorldInitialized()
    --Moved this into OnWorldInitialized, it is inconsistent when included directly in init.lua 
    dofile("mods/noita-together/files/ws/ws.lua")
end

--used to detect settings changes
--wiki: OnModSettingsChanged "Note: This callback doesn't appear to work. Modders have resorted to using OnPausedChanged instead to detect potential settings changes."
function OnPausedChanged(is_paused, is_inventory_paused)
    if not ModSettingGet("noita-together.NT_NO_STAT_PROGRESS") and GameHasFlagRun("NT_option_disable_progress") then
        --nt print_error("Removing no_progress flags, option disabled")
        SetProgressDisable(false)
    elseif ModSettingGet("noita-together.NT_NO_STAT_PROGRESS") and not GameHasFlagRun("NT_option_disable_progress") then
        --nt print_error("Addding no_progress flags, option enabled")
        SetProgressDisable(true)
    end
end
