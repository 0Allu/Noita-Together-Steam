dofile_once("mods/noita-together/files/store.lua")
local entity_id = GetUpdatedEntityID()

if (NT.run_started) then
    EntityKill(entity_id)
    return
end

-- the host starts the run from the game (HostStartRunTick in utils.lua), so tell them how
local key = "$noitatogether_wait_for_start"
if (GameHasFlagRun("NT_is_host") and type(InputIsKeyJustDown) == "function") then
    key = "$noitatogether_host_start_hint"
end
local sprite = EntityGetFirstComponentIncludingDisabled(entity_id, "SpriteComponent")
local text = GameTextGet(key)
if (sprite ~= nil and ComponentGetValue2(sprite, "text") ~= text) then
    ComponentSetValue2(sprite, "text", text)
    EntityRefreshSprite(entity_id, sprite)
end
