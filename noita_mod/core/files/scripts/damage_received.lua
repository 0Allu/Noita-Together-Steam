-- On the player (added in init.lua OnPlayerSpawned). Remembers what last hurt them, so a
-- death can say what killed them instead of the "deferred death" Noita reports for the
-- mod's delayed kill (the mod sets wait_for_kill_flag_on_death to handle respawns and run ends).
function damage_received(damage, message, entity_thats_responsible, is_fatal, projectile_thats_responsible)
    if damage == nil or damage <= 0 then return end
    local who = ""
    local me = GetUpdatedEntityID()
    if entity_thats_responsible ~= nil and entity_thats_responsible ~= 0 and entity_thats_responsible ~= me
        and EntityGetIsAlive(entity_thats_responsible) then
        who = EntityGetName(entity_thats_responsible) or ""
    end
    GlobalsSetValue("NT_last_damage_by", who)
    GlobalsSetValue("NT_last_damage_msg", message or "")
end
