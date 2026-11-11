<template>
    <vModal ref="vFlagsModal">
        <h1 slot="header" class="options-title">
            Game Options
            <span v-if="!isHost" class="options-readonly">Only the host can change these</span>
        </h1>
        <template slot="body">
          <div class="options">
            <section v-for="group in groups" :key="group.key" class="options-group">
                <h2 class="options-group-title">
                    <i class="fas" :class="group.icon"></i>
                    {{ group.title }}
                </h2>

                <!-- Death & health: the death penalty picker -->
                <div v-if="group.key === 'death'" class="options-field">
                    <span class="options-label">
                        Death penalty
                        <vTooltip>
                            <span>{{ tooltip("NT_death_penalty", true) }}</span>
                        </vTooltip>
                    </span>
                    <select
                        class="slot-selector"
                        :disabled="!isHost"
                        v-model="tempFlags.NT_death_penalty.value"
                    >
                        <option
                            v-for="(value, key) in deathFlags"
                            :key="key"
                            :value="key"
                        >
                            {{ value.name }}
                        </option>
                    </select>
                    <p v-if="sharedHealth" class="field-hint">
                        Health and max HP are shared, so Sync Hearts is turned off.
                    </p>
                </div>

                <div v-if="group.switches.length" class="switches">
                    <vSwitch
                        v-for="id in group.switches"
                        :key="id"
                        v-model="tempFlags[id].value"
                        :disabled="!isHost"
                    >
                        <span>{{ flagInfo(id).name }}</span>
                        <vTooltip>
                            <span>{{ tooltip(id, false) }}</span>
                        </vTooltip>
                    </vSwitch>
                </div>

                <p v-if="group.key === 'bank' && sharedGold && tempFlags.NT_send_gold" class="field-hint bank-hint">
                    Gold is shared, so Send Gold is off until Shared Gold is turned off.
                </p>

                <!-- Sharing: how many orbs get shared -->
                <div v-if="group.key === 'sharing' && tempFlags.NT_sync_orbs && tempFlags.NT_sync_orbs.value" class="options-field options-inline">
                    <span class="options-label">
                        Share orbs until
                        <vTooltip>
                            <span>{{ tooltip("NT_sync_orb_count", false) }}</span>
                        </vTooltip>
                    </span>
                    <label class="field orb-field">
                        <i class="fas fa-circle"></i>
                        <input
                            type="number"
                            min="0"
                            :disabled="!isHost"
                            v-model.number="tempFlags.NT_sync_orb_count.value"
                        />
                    </label>
                    <span class="field-hint">orbs (0 = no limit)</span>
                </div>

                <!-- Perks: the ban list -->
                <div v-if="group.key === 'perks' && tempFlags.NT_banned_perks" class="options-field">
                    <span class="options-label">
                        Banned perks
                        <vTooltip>
                            <span>{{ tooltip("NT_banned_perks", false) }}</span>
                        </vTooltip>
                        <button
                            v-if="isHost && bannedPerks.length > 1"
                            type="button"
                            class="link-button"
                            @click="setBannedPerks([])"
                        >Clear all</button>
                    </span>
                    <div class="perk-chips">
                        <span
                            v-for="id in bannedPerks"
                            :key="id"
                            class="perk-chip"
                            :title="perkInfo(id).desc || id"
                        >
                            <i class="fas fa-ban"></i>
                            {{ perkInfo(id).name }}
                            <button
                                v-if="isHost"
                                type="button"
                                class="perk-chip-remove"
                                :title="'Allow ' + perkInfo(id).name + ' again'"
                                @click="unbanPerk(id)"
                            >
                                <i class="fas fa-times"></i>
                            </button>
                        </span>
                        <span v-if="!bannedPerks.length" class="perk-none">No perks are banned.</span>
                    </div>
                    <div v-if="isHost" class="perk-search">
                        <label class="field">
                            <i class="fas fa-search"></i>
                            <input
                                ref="perkSearch"
                                v-model="perkQuery"
                                placeholder="Search perks to ban..."
                                spellcheck="false"
                                @keydown.down.prevent="movePerkCursor(1)"
                                @keydown.up.prevent="movePerkCursor(-1)"
                                @keydown.enter.prevent="banHighlighted"
                                @keydown.esc.stop.prevent="perkQuery = ''"
                            />
                        </label>
                        <ul v-if="perkQuery.trim()" class="perk-results">
                            <li
                                v-for="(perk, i) in perkMatches"
                                :key="perk.id"
                                :class="{ active: i === perkCursor }"
                                @mouseenter="perkCursor = i"
                                @mousedown.prevent="banPerk(perk.id)"
                            >
                                <span class="perk-result-name">{{ perk.name }}</span>
                                <span class="perk-result-id">{{ perk.id }}</span>
                                <span v-if="perk.pool === false" class="perk-result-tag" title="Doesn't normally show up in holy mountains">special</span>
                            </li>
                            <li v-if="!perkMatches.length" class="perk-results-empty">
                                No perk matches "{{ perkQuery.trim() }}".
                            </li>
                        </ul>
                        <p v-if="!perkListLoaded" class="field-hint">
                            Only a few perks are listed until Noita has connected once.
                            You can also type a perk ID, like GLASS_CANNON.
                        </p>
                    </div>
                </div>

                <!-- World: the seed -->
                <div v-if="group.key === 'world'" class="options-field">
                    <span class="options-label">
                        World seed
                        <vTooltip>
                            <span>{{ tooltip("NT_sync_world_seed", false) }}</span>
                        </vTooltip>
                    </span>
                    <vSwitch
                        v-if="tempFlags.NT_random_shared_seed"
                        v-model="tempFlags.NT_random_shared_seed.value"
                        :disabled="!isHost"
                        class="seed-switch"
                    >
                        <span>{{ flagInfo("NT_random_shared_seed").name }}</span>
                        <vTooltip>
                            <span>{{ tooltip("NT_random_shared_seed", false) }}</span>
                        </vTooltip>
                    </vSwitch>
                    <div class="field-row seed-row">
                        <label class="field">
                            <i class="fas fa-globe"></i>
                            <input
                                type="number"
                                min="0"
                                :disabled="!isHost || sharedSeed"
                                v-model.number="tempFlags.NT_sync_world_seed.value"
                            />
                        </label>
                        <vButton
                            size="btn-field"
                            :disabled="!isHost || sharedSeed"
                            @click="randomizeSeed"
                            title="Pick a random seed"
                        >
                            <i class="fas fa-dice" slot="icon"></i>
                        </vButton>
                    </div>
                    <p class="field-hint">
                        <template v-if="sharedSeed">Picked automatically, with a new one after every run.</template>
                        <template v-else-if="!tempFlags.NT_sync_world_seed.value">0: everyone gets their own random world.</template>
                        <template v-else>Everyone plays this seed.</template>
                    </p>
                </div>
            </section>
          </div>
        </template>
        <div slot="footer" class="options-footer">
            <div class="presets">
                <vButton size="btn-small" @click="loadPresets" :disabled="!isHost">
                    <i class="fas fa-folder-open" slot="icon"></i>
                    Load preset
                </vButton>
                <vButton size="btn-small" @click="savePresets">
                    <i class="fas fa-save" slot="icon"></i>
                    Save preset
                </vButton>
            </div>
            <div class="options-buttons">
                <template v-if="isHost">
                    <vButton class="btn-primary" @click="applyFlags">Apply</vButton>
                    <vButton @click="close">Cancel</vButton>
                </template>
                <vButton v-else @click="close">Close</vButton>
            </div>
        </div>
    </vModal>
</template>

<script>
import vSwitch from "../components/vSwitch.vue"
import vModal from "../components/vModal.vue"
import vButton from "../components/vButton.vue"
import vTooltip from "../components/vTooltip.vue"
import { flagInfo } from "../store/index.js"
import { remote } from 'electron'
import fs from "fs";
const dialog = remote.dialog

// How Game Options are grouped. Switches a game mode doesn't have are skipped;
// switches not listed here end up under "Other".
const OPTION_GROUPS = [
    { key: "death", title: "Death & health", icon: "fa-heart", switches: ["NT_ondeath_kick", "NT_sync_hearts", "NT_alt_heartache"] },
    { key: "nemesis", title: "Nemesis", icon: "fa-crosshairs", switches: ["NT_NEMESIS_nemesis_abilities", "NT_NEMESIS_ban_ambrosia", "NT_NEMESIS_ban_invis"] },
    { key: "sharing", title: "Shared between players", icon: "fa-people-arrows", switches: ["NT_shared_gold", "NT_sync_orbs", "NT_sync_orbs_no_curse", "NT_sync_shift", "NT_sync_steve"] },
    { key: "perks", title: "Perks", icon: "fa-star", switches: ["NT_team_perks", "NT_sync_perks"] },
    { key: "bank", title: "Item bank", icon: "fa-box-open", switches: ["NT_send_wands", "NT_send_flasks", "NT_send_items", "NT_send_gold"] },
    { key: "world", title: "World", icon: "fa-globe-americas", switches: ["NT_world_randomize_loot", "NT_random_loadouts"] },
    { key: "host", title: "Host checks", icon: "fa-filter", switches: ["NT_filter_invalid_data", "NT_filter_kick"] }
]

// until the mod has sent the game's perk list
const FALLBACK_PERKS = [{ id: "GLASS_CANNON", name: "Glass Cannon", desc: "", pool: true }]

function parsePerkList(value) {
    return String(value || "").split(",").map((s) => s.trim()).filter(Boolean)
}

// GLASS_CANNON -> Glass Cannon
function humanizePerkId(id) {
    return id.toLowerCase().split("_").filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

// Copy known options from a saved preset. Options the preset doesn't have keep their current
// value, and anything this version doesn't know about is ignored.
function applyPreset(current, preset) {
    const next = {}
    for (const id of Object.keys(current)) {
        const saved = preset && preset[id]
        const ok = saved && typeof saved === "object" && typeof saved.value === typeof current[id].value
        next[id] = ok ? Object.assign({}, current[id], { value: saved.value }) : current[id]
    }
    // presets from before the ban list only had "Ban Glass Cannon"
    if (next.NT_banned_perks && preset && preset.NT_ban_perks && preset.NT_ban_perks.value === true &&
        !(preset.NT_banned_perks && typeof preset.NT_banned_perks.value === "string")) {
        next.NT_banned_perks = Object.assign({}, next.NT_banned_perks, { value: "GLASS_CANNON" })
    }
    // Shared Health used to be a switch; it's a death penalty now
    if (next.NT_death_penalty && preset && preset.NT_shared_health && preset.NT_shared_health.value === true &&
        next.NT_death_penalty.choices.indexOf("shared_health") !== -1) {
        next.NT_death_penalty = Object.assign({}, next.NT_death_penalty, { value: "shared_health" })
    }
    return next
}

export default {
    //braincells where'd ya go
    name: "vRoomFlags",
    components: {
        vButton,
        vModal,
        vSwitch,
        vTooltip
    },
    beforeMount() {
        // create a "working copy" of the flags - so that we can cancel without
        // affecting the store
        const obj = {}
        for (const flag of this.$store.getters.flags) {
            obj[flag.id] = Object.assign({}, flag)
        }
        this.tempFlags = obj
        this.gamemode = this.$store.getters.roomGamemode
    },
    data() {
        return {
            gamemode: null,
            tempFlags: null,
            perkQuery: "",
            perkCursor: 0
        }
    },
    computed: {
        isHost() {
            return this.$store.getters.isHost
        },
        sharedGold() {
            return !!this.tempFlags.NT_shared_gold && this.tempFlags.NT_shared_gold.value
        },
        sharedHealth() {
            const flag = this.tempFlags.NT_death_penalty
            return !!flag && flag.value === "shared_health"
        },
        /** switches that don't apply with the current settings */
        hiddenSwitches() {
            const hidden = ["NT_random_shared_seed"] // shown with the world seed
            // these only change something when everyone plays the same world
            if (!this.seedShared) hidden.push("NT_world_randomize_loot", "NT_random_loadouts")
            // max hp is shared, so hearts are shared through it
            if (this.sharedHealth) hidden.push("NT_sync_hearts")
            // one wallet for everyone, so there's no gold to deposit
            if (this.sharedGold) hidden.push("NT_send_gold")
            // "no effect without Sync Orbs"
            if (this.tempFlags.NT_sync_orbs && !this.tempFlags.NT_sync_orbs.value) hidden.push("NT_sync_orbs_no_curse")
            // nothing to kick for without the filter
            if (this.tempFlags.NT_filter_invalid_data && !this.tempFlags.NT_filter_invalid_data.value) hidden.push("NT_filter_kick")
            return hidden
        },
        groups() {
            const shown = (id) => this.tempFlags[id] && this.tempFlags[id].type === "boolean" &&
                this.hiddenSwitches.indexOf(id) === -1
            const used = {}
            const groups = OPTION_GROUPS.map((g) => {
                g.switches.forEach((id) => { used[id] = true })
                return Object.assign({}, g, { switches: g.switches.filter(shown) })
            })
            // anything a newer mode adds that isn't sorted yet
            const other = Object.keys(this.tempFlags).filter((id) => !used[id] && shown(id))
            groups.push({ key: "other", title: "Other", icon: "fa-sliders-h", switches: other })
            return groups.filter((g) =>
                g.switches.length ||
                (g.key === "death" && this.tempFlags.NT_death_penalty) ||
                (g.key === "perks" && this.tempFlags.NT_banned_perks) ||
                (g.key === "world" && this.tempFlags.NT_sync_world_seed)
            )
        },
        seedShared() {
            const seed = this.tempFlags.NT_sync_world_seed
            return this.sharedSeed || !!(seed && Number(seed.value) > 0)
        },
        sharedSeed() {
            const flag = this.tempFlags.NT_random_shared_seed
            return !!(flag && flag.value)
        },
        deathFlags() {
            return flagInfo[this.gamemode].NT_death_penalty
        },
        perkListLoaded() {
            return this.$store.state.perkList.length > 0
        },
        knownPerks() {
            return this.perkListLoaded ? this.$store.state.perkList : FALLBACK_PERKS
        },
        bannedPerks() {
            const flag = this.tempFlags.NT_banned_perks
            return flag ? parsePerkList(flag.value) : []
        },
        perkMatches() {
            const q = this.perkQuery.trim().toLowerCase()
            if (!q) return []
            const banned = this.bannedPerks
            const matches = this.knownPerks
                .filter((p) => banned.indexOf(p.id) === -1)
                .filter((p) => p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1)
                .sort((a, b) => {
                    const aStart = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1
                    const bStart = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1
                    return aStart - bStart || a.name.localeCompare(b.name)
                })
                .slice(0, 8)
            // without the game's list, let the host type an id
            const typedId = this.perkQuery.trim().toUpperCase().replace(/\s+/g, "_")
            if (!this.perkListLoaded && /^[A-Z0-9_]+$/.test(typedId) &&
                banned.indexOf(typedId) === -1 && !matches.some((p) => p.id === typedId)) {
                matches.push({ id: typedId, name: humanizePerkId(typedId) })
            }
            return matches
        }
    },
    watch: {
        perkQuery() {
            this.perkCursor = 0
        }
    },
    methods: {
        flagInfo(id, val) {
            const gamemode = this.gamemode
            if (!Object.prototype.hasOwnProperty.call(flagInfo, gamemode)) {
                throw new Error(
                    "Invalid flagInfo call: gamemode " +
                        gamemode +
                        " not present"
                )
            }

            /** @type {import('../store/index.js').VueFlag|undefined} */
            const spec = this.tempFlags[id]
            if (!spec) {
                throw new Error(
                    "Invalid flagInfo call: id " + id + " not present"
                )
            }

            switch (spec.type) {
                case "string":
                case "number":
                case "boolean":
                    return flagInfo[gamemode][id]
                case "enum":
                    if (spec.choices.indexOf(val) === -1) {
                        throw new Error(
                            "Invalid flagInfo call: enum value " +
                                val +
                                " not present"
                        )
                    }
                    return flagInfo[gamemode][id][val]
            }
        },
        tooltip(id, isEnum) {
            if (!isEnum) {
                return this.flagInfo(id).tooltip
            }
            const enumValue = (this.tempFlags[id] || { value: null }).value
            return this.flagInfo(id, enumValue).tooltip
        },
        applyFlags() {
          //if tempFlags.NT_sync_orbs.value is false, set the orb count to 0
          if (!this.tempFlags.NT_sync_orbs.value) {
            this.tempFlags.NT_sync_orb_count.value = 0
          }
          // Sync Hearts and Send Gold keep their values while shared health / Shared Gold
          // hide them. The app leaves them out for the game (noita.js updateFlags), so they
          // come back as they were when those options are turned off again.
          // number inputs can hold "", negatives or decimals; the mod wants a whole number >= 0
          for (const id of ["NT_sync_orb_count", "NT_sync_world_seed"]) {
            const n = Math.floor(Number(this.tempFlags[id].value))
            this.tempFlags[id].value = n > 0 ? Math.min(n, 4294967295) : 0
          }
          this.$emit("applyFlags", Object.values(this.tempFlags))
        },
        loadPresets(){
          dialog.showOpenDialog({
            properties: ['openFile'],
            title: "Load NT Lobby Preset",
            filters: ["json"],
            buttonLabel: "Load"
          })
              .then((dialogReturn)=>{
                if(dialogReturn.canceled) return;
                // fileNames is an array that contains all the selected
                if(dialogReturn.filePaths === undefined || dialogReturn.filePaths.length === 0){
                  console.log("No file selected");
                  return;
                }
                const filePath = dialogReturn.filePaths[0]

                fs.readFile(filePath, 'utf-8', (err, data) => {
                  if(err){
                    alert("Couldn't read that file: " + err.message);
                    return;
                  }

                  // Change how to handle the file content
                  console.log("The file content is : " + data);
                  const oldSeed = this.tempFlags.NT_sync_world_seed.value
                  let preset
                  try {
                    preset = JSON.parse(data)
                  } catch (e) {
                    alert("That file isn't a Noita Together preset.")
                    return
                  }
                  this.tempFlags = applyPreset(this.tempFlags, preset)
                  this.tempFlags.NT_sync_world_seed.value = oldSeed
                });
              });
        },
        savePresets(){
          dialog.showSaveDialog({
            properties: ['showOverwriteConfirmation'],
            title: "Save NT Lobby Preset",
            defaultPath: "nt-lobby-preset.json",
            buttonLabel: "Save"
          }).then((dialogReturn) => {
            if(dialogReturn.canceled) return;
            // fileNames is an array that contains all the selected
            if(dialogReturn.filePath === undefined || dialogReturn.filePath.length === 0){
              console.log("No file selected");
              return;
            }
            const filePath = dialogReturn.filePath
            fs.writeFile(filePath, JSON.stringify(this.tempFlags), {}, (err)=>{
              if(err) alert(err)
            })
          })
        },
        perkInfo(id) {
            const known = this.knownPerks.find((p) => p.id === id)
            return known || { id, name: humanizePerkId(id), desc: "" }
        },
        setBannedPerks(ids) {
            this.tempFlags.NT_banned_perks.value = ids.join(",")
        },
        banPerk(id) {
            if (this.bannedPerks.indexOf(id) === -1) this.setBannedPerks(this.bannedPerks.concat([id]))
            this.perkQuery = ""
            if (this.$refs.perkSearch) this.$refs.perkSearch.focus()
        },
        unbanPerk(id) {
            this.setBannedPerks(this.bannedPerks.filter((p) => p !== id))
        },
        movePerkCursor(by) {
            const n = this.perkMatches.length
            if (n) this.perkCursor = (this.perkCursor + by + n) % n
        },
        banHighlighted() {
            const perk = this.perkMatches[this.perkCursor]
            if (perk) this.banPerk(perk.id)
        },
        randomizeSeed() {
            this.tempFlags.NT_sync_world_seed.value = Math.floor(Math.random() * 4294967295) + 1
        },
        close() {
            this.$emit("close")
        }
    }
}
</script>

<style>
.options-title {
    display: flex;
    align-items: baseline;
    gap: 0.8em;
}

.options-readonly {
    font-size: 0.45em;
    color: rgba(255, 255, 255, 0.5);
}

.options {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
}

.options-group {
    padding: 12px 14px 14px;
    background: #232323;
    border: 1px solid #333;
}

.options-group-title {
    display: flex;
    align-items: center;
    gap: 0.55em;
    margin: 0 0 10px;
    font-size: 0.95em;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
}

.options-group-title > i {
    width: 1.1em;
    text-align: center;
    font-size: 0.9em;
    color: rgba(255, 255, 255, 0.45);
}

.options-field + .switches,
.switches + .options-field,
.options-field + .options-field {
    margin-top: 12px;
}

.options-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    margin-bottom: 6px;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.5);
}

.options-inline {
    display: flex;
    align-items: center;
    gap: 10px;
}

.options-inline .options-label {
    margin-bottom: 0;
}

.options-inline .field-hint {
    margin: 0;
}

.field-hint.bank-hint {
    margin: 8px 0 0;
}

.seed-row {
    max-width: 360px;
}

.options-heading {
    display: flex;
    align-items: center;
    margin: 0 0 8px;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.5);
}

.options-heading > span {
    font-size: inherit;
    color: inherit;
}

.options .slot-selector {
    width: 100%;
}

.switches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px 10px;
}

.switches > div,
.seed-switch {
    display: flex;
    align-items: center;
    white-space: nowrap;
}

.seed-switch {
    margin-bottom: 8px;
}

.options-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 18px 28px;
    align-items: start;
}

.orb-field {
    width: 110px;
}

.field-hint {
    margin: 6px 0 0;
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.45);
}

.options-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    width: 100%;
    gap: 8px;
}

.options-footer .btn {
    white-space: nowrap;
}

.presets {
    display: flex;
    gap: 6px;
}

.options-buttons {
    display: flex;
    gap: 6px;
    margin-left: auto;
}

.link-button {
    margin-left: auto;
    padding: 0;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.55);
    font: inherit;
    font-size: 0.95em;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
}

.link-button:hover {
    color: rgba(255, 255, 255, 0.9);
    text-decoration: underline;
}

.perk-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}

.perk-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.25em 0.35em 0.25em 0.65em;
    background: #3a2626;
    border: 1px solid #5c3434;
    border-radius: 1em;
    font-size: 0.9em;
    white-space: nowrap;
}

.perk-chip > .fa-ban {
    font-size: 0.8em;
    color: #e06c6c;
}

.perk-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5em;
    height: 1.5em;
    padding: 0;
    background: none;
    border: none;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
}

.perk-chip-remove:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
}

.perk-none {
    padding: 0.3em 0;
    font-size: 0.9em;
    color: rgba(255, 255, 255, 0.45);
}

.perk-results {
    max-height: 200px;
    overflow-y: auto;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
    background: #262626;
    border: 1px solid #3c3c3c;
}

.perk-results > li {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0.45em 0.75em;
    cursor: pointer;
}

.perk-results > li.active {
    background: #353535;
}

.perk-result-id {
    font-family: monospace;
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.4);
}

.perk-result-tag {
    margin-left: auto;
    font-size: 0.75em;
    color: rgba(255, 255, 255, 0.45);
}

.perk-results > li.perk-results-empty {
    cursor: default;
    color: rgba(255, 255, 255, 0.45);
}

span + .tooltip-wrapper {
    margin-left: 0.5em;
}
</style>
