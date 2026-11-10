-- Shared gold and shared health (room options NT_shared_gold, and the "Shared health" death
-- penalty NT_death_penalty_shared_health; NT_shared_health is the same thing from older app builds).
--
-- Every player watches their own wallet and health. When either changes, the
-- change (not the total) is sent to everyone else, who apply the same change.
-- Changes that arrive from others are added to the baseline, so they are never
-- sent back out.
--
-- Health rules:
--  * damage and healing are shared
--  * with the "Shared health" death penalty, max hp is shared too: whenever yours changes, the
--    new value is sent and everyone takes it (a value, not a change, so effects that already
--    happen to every player, like shared perks, don't stack up). The app turns Sync Hearts
--    off in that mode, since hearts are then shared through max hp.
--  * with the old NT_shared_health switch, max hp stays separate
--  * someone else's damage stops at 1 hp; the player who took the fatal hit dies, and the
--    death penalty (like "End run") ends the run for everyone
--  * respawning after a death refills only your own health

SharedPools = SharedPools or { gold = nil, hp = nil, max_hp = nil, pending_gold = 0 }

local TICK_FRAMES = 10
local HP_EPSILON = 0.004 -- 0.1 hp on screen (the game shows hp * 25)
local MIN_REMOTE_HP = 0.04 -- 1 hp on screen

local function shared_health_on()
    return GameHasFlagRun("NT_death_penalty_shared_health") or GameHasFlagRun("NT_shared_health")
end

local function shared_max_hp_on()
    return GameHasFlagRun("NT_death_penalty_shared_health")
end

local function pools_active()
    return NT ~= nil and NT.run_started and not NT.run_ended
end

local function player_components()
    local player = GetPlayer()
    if player == nil then return nil, nil end
    return EntityGetFirstComponent(player, "WalletComponent"), EntityGetFirstComponent(player, "DamageModelComponent")
end

local function send(name, delta, max_hp)
    if SendWsEvent ~= nil then
        SendWsEvent({ event = "CustomModEvent", payload = { name = name, delta = delta, max = max_hp } })
    end
end

-- Take the current values as the new baseline on the next tick, without sending anything.
function SharedPoolsResync()
    SharedPools.gold = nil
    SharedPools.hp = nil
    SharedPools.max_hp = nil
end

local function tick_gold(wallet)
    local money = ComponentGetValue2(wallet, "money")
    if SharedPools.pending_gold ~= 0 then
        -- gold that arrived while we had no wallet (polymorphed)
        local new = math.max(0, money + SharedPools.pending_gold)
        ComponentSetValue2(wallet, "money", new)
        SharedPools.pending_gold = 0
        if SharedPools.gold ~= nil then SharedPools.gold = SharedPools.gold + (new - money) end
        money = new
    end
    if SharedPools.gold == nil then
        SharedPools.gold = money
    elseif money ~= SharedPools.gold then
        send("SharedGold", money - SharedPools.gold)
        SharedPools.gold = money
    end
end

local function tick_health(damage_model)
    local hp = math.max(0, ComponentGetValue2(damage_model, "hp"))
    local max_hp = ComponentGetValue2(damage_model, "max_hp")
    if SharedPools.hp == nil then
        SharedPools.hp = hp
        SharedPools.max_hp = max_hp
        return
    end
    local share_max = shared_max_hp_on()
    local dhp = hp - SharedPools.hp
    local dmax = max_hp - SharedPools.max_hp
    if dmax > 0 and not share_max then
        -- a heart raises max and current hp together; only the extra healing is shared
        -- (with shared max hp the heal is shared as well, so everyone ends up equal)
        dhp = dhp - dmax
    elseif dmax < 0 and dhp < 0 then
        -- losing max hp (respawn penalty, glass cannon) drags current hp down with it; that isn't damage
        dhp = math.min(0, dhp - dmax)
    end
    SharedPools.max_hp = max_hp
    local send_hp = math.abs(dhp) >= HP_EPSILON
    local send_max = share_max and dmax ~= 0
    if send_hp or send_max then
        send("SharedHealth", send_hp and dhp or 0, send_max and max_hp or nil)
    end
    if send_hp then
        SharedPools.hp = hp
    else
        -- too small to send yet (slow regeneration); keep it for the next tick
        SharedPools.hp = hp - dhp
    end
end

-- called every frame from OnWorldPostUpdate
function SharedPoolsTick()
    if GameGetFrameNum() % TICK_FRAMES ~= 0 then return end
    local gold_on = GameHasFlagRun("NT_shared_gold")
    local health_on = shared_health_on()
    if not (gold_on or health_on) or not pools_active() then
        SharedPoolsResync()
        SharedPools.pending_gold = 0
        return
    end
    local wallet, damage_model = player_components()
    if gold_on and wallet ~= nil then tick_gold(wallet) end
    if health_on and damage_model ~= nil and not Respawning then tick_health(damage_model) end
end

-- SharedGold custom event from another player
function SharedPoolsOnGold(data)
    if not GameHasFlagRun("NT_shared_gold") or not pools_active() then return end
    local delta = tonumber(data.delta) or 0
    if delta == 0 then return end
    local wallet = player_components()
    if wallet == nil then
        SharedPools.pending_gold = SharedPools.pending_gold + delta
        return
    end
    local money = ComponentGetValue2(wallet, "money")
    local new = math.max(0, money + delta)
    ComponentSetValue2(wallet, "money", new)
    if SharedPools.gold ~= nil then SharedPools.gold = SharedPools.gold + (new - money) end
end

-- SharedHealth custom event from another player
function SharedPoolsOnHealth(data)
    if not shared_health_on() or not pools_active() or Respawning then return end
    local delta = tonumber(data.delta) or 0
    local new_max = shared_max_hp_on() and tonumber(data.max) or nil
    if delta == 0 and new_max == nil then return end
    local _, damage_model = player_components()
    if damage_model == nil then return end
    local hp = ComponentGetValue2(damage_model, "hp")
    if hp <= 0 then return end -- already dying, let the death penalty handle it
    local max_hp = ComponentGetValue2(damage_model, "max_hp")
    if new_max ~= nil and new_max > 0 and new_max ~= max_hp then
        -- take their max hp; taking it isn't a change of ours to send back
        ComponentSetValue2(damage_model, "max_hp", new_max)
        max_hp = new_max
        if SharedPools.max_hp ~= nil then SharedPools.max_hp = new_max end
        if hp > max_hp then
            ComponentSetValue2(damage_model, "hp", max_hp)
            if SharedPools.hp ~= nil then SharedPools.hp = SharedPools.hp + (max_hp - hp) end
            hp = max_hp
        end
    end
    if delta == 0 then return end
    local new
    if delta < 0 then
        new = math.max(hp + delta, math.min(hp, MIN_REMOTE_HP))
    else
        new = math.max(hp, math.min(max_hp, hp + delta))
    end
    if new == hp then return end
    ComponentSetValue2(damage_model, "hp", new)
    if SharedPools.hp ~= nil then SharedPools.hp = SharedPools.hp + (new - hp) end
end
