-- On the player (added in init.lua OnPlayerSpawned). Remembers what hurt them, so a
-- death can say what killed them instead of the "deferred death" Noita reports for the
-- mod's delayed kill (the mod sets wait_for_kill_flag_on_death to handle respawns and run ends).
--
-- The player stays alive below 0 hp until the mod kills them, and burning, lava or poison
-- keep hurting them in the meantime, so the hit that took them to 0 is kept separately
-- (NT_fatal_damage_*) and isn't overwritten by those. utils.lua clears it if they survive.
function damage_received(damage, message, entity_thats_responsible, is_fatal, projectile_thats_responsible)
    if damage == nil or damage <= 0 then return end
    -- the mod is killing the player to end the run; that isn't something that hurt them
    if GlobalsGetValue("NT_killing_player", "0") == "1" then return end
    local who = ""
    local me = GetUpdatedEntityID()
    if entity_thats_responsible ~= nil and entity_thats_responsible ~= 0 and entity_thats_responsible ~= me
        and EntityGetIsAlive(entity_thats_responsible) then
        who = EntityGetName(entity_thats_responsible) or ""
    end
    GlobalsSetValue("NT_last_damage_by", who)
    GlobalsSetValue("NT_last_damage_msg", message or "")
    -- is_fatal may not be set while wait_for_kill_flag_on_death holds the player alive, so
    -- also check hp. A big hit that doesn't kill can pass this check too, but utils.lua
    -- clears the record on the same frame when the player is still above 0 hp.
    if not is_fatal then
        local damage_model = EntityGetFirstComponent(me, "DamageModelComponent")
        if damage_model ~= nil and ComponentGetValue2(damage_model, "hp") - damage <= 0 then
            is_fatal = true
        end
    end
    if is_fatal and GlobalsGetValue("NT_fatal_damage_set", "0") ~= "1" then
        GlobalsSetValue("NT_fatal_damage_set", "1")
        GlobalsSetValue("NT_fatal_damage_by", who)
        GlobalsSetValue("NT_fatal_damage_msg", message or "")
    end
end
