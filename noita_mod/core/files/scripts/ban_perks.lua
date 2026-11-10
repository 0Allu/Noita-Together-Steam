-- Perks with their own "banned" sprite in files/items_gfx/banned_perks/<id lowercase>.png.
-- Every other banned perk shows its normal icon with a red cross over it.
BANNED_PERK_CUSTOM_SPRITES = {
    GLASS_CANNON = true
}

-- Returns a table of banned perk_list.id string values.
-- The room host picks them in the app; events.lua UpdateFlags stores them in the
-- NT_banned_perks global as a comma separated list (globals are shared by every lua context).
function BannedPerksTable()
    local banned_perks = {}
    local list = GlobalsGetValue("NT_banned_perks", "")
    for perk_id in string.gmatch(list, "[^,]+") do
        table.insert(banned_perks, perk_id)
    end
    -- rooms from older app versions only had "Ban Glass Cannon"
    if #banned_perks == 0 then
        table.insert(banned_perks, "GLASS_CANNON")
    end
    return banned_perks
end

-- Returns if a perk_id is currently banned
function IsBannedPerkId(perk_id)
    if (not GameHasFlagRun("NT_ban_perks")) then
        return false
    end
    for _, _perk_id in ipairs(BannedPerksTable()) do
        if _perk_id == perk_id then
            return true
        end
    end
    return false
end

-- Returns is a perk_id could be banned. Any perk can be put on the ban list, and the list can
-- change mid-run, so every perk in the world gets the check script.
function ISBannablePerkId(perk_id)
    return perk_id ~= nil and perk_id ~= ""
end

-- Returns all repeatedly utilized VariableStorageComponent values to avoid multiple iterations across components
function GetKeyPerkComponents(entity_item)
    local components = EntityGetComponent(entity_item, "VariableStorageComponent")
    local perk_id
    local dont_remove_other_perks
    local nt_dont_share
    if (components ~= nil) then
        for key, comp_id in pairs(components) do
            local var_name = ComponentGetValue(comp_id, "name")
            if (var_name == "perk_id") then
                perk_id = ComponentGetValue2(comp_id, "value_string")
            end
            if (var_name == "perk_dont_remove_others") then
                dont_remove_other_perks = ComponentGetValue2(comp_id, "value_bool")
            end
            if (var_name == "NT_DONT_SHARE") then
                nt_dont_share = true
            end
        end
    end
    local perk_components = {
        perk_id = perk_id,
        dont_remove_other_perks = dont_remove_other_perks,
        nt_dont_share = nt_dont_share
    }
    return perk_components
end
