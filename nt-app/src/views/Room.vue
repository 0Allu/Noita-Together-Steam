<template>
    <div class="content" id="room">
        <vRoomFlags v-if="showRoomFlags" @applyFlags="sendFlags" @close="closeRoomFlags" />
        <vLeaveRoom v-if="showLeaveModal" @close="closeLeaveModal" />
        <vPlayerLimitDialog
            v-if="showLimitModal"
            :current="room.maxUsers"
            :player-count="users.length"
            @save="setPlayerLimit"
            @close="showLimitModal = false"
        />

        <div class="room-header">
            <vButton @click="openLeaveRoom" title="Leave room">
                <i class="fas fa-arrow-left" slot="icon"></i>
            </vButton>
            <div class="room-title">
                <h1 :title="room.name">{{ room.name }}</h1>
                <span class="room-mode" :class="'mode-' + room.gamemode" title="Game mode">{{ gamemodeName }}</span>
                <button
                    class="room-count"
                    :class="{ editable: isHost }"
                    :disabled="!isHost"
                    :title="isHost ? 'Players in the room. Click to change the limit.' : 'Players in the room'"
                    @click="showLimitModal = true"
                >
                    <i class="fas fa-user"></i>{{ users.length }}/{{ room.maxUsers }}
                    <i v-if="isHost" class="fas fa-pen room-count-edit"></i>
                </button>
            </div>
            <div class="room-edit">
                <vButton
                    class="noita-button"
                    :class="{ 'btn-primary': noitaState === 'idle', 'noita-on': noitaState === 'connected' }"
                    :disabled="noitaState !== 'idle'"
                    :title="noitaTitle"
                    @click="startNoita"
                >
                    <i class="fas fa-check" slot="icon" v-if="noitaState === 'connected'"></i>
                    <i class="fas fa-circle-notch fa-spin" slot="icon" v-else-if="noitaState === 'starting'"></i>
                    <i class="fas fa-play" slot="icon" v-else></i>
                    <span class="noita-button-text">{{ noitaLabel }}</span>
                </vButton>
                <button
                    v-if="lobbyCode"
                    class="invite-chip"
                    :class="{ copied }"
                    @click="copyInviteCode"
                    title="Copy the invite code. Friends paste it in the lobby to join."
                >
                    <span class="invite-label">{{ copied ? "Copied!" : "Invite code" }}</span>
                    <span class="invite-code">
                        <i class="fas fa-check" v-if="copied"></i>
                        <i class="fas fa-copy" v-else></i>
                        {{ lobbyCode }}
                    </span>
                </button>
                <vButton
                    @click="lockRoom"
                    :disabled="!isHost"
                    :title="room.locked ? lockedTitle : unlockedTitle"
                >
                    <i class="fas fa-lock" slot="icon" v-if="room.locked"></i>
                    <i class="fas fa-lock-open" slot="icon" v-else></i>
                </vButton>
                <vButton @click="openRoomFlags" :title="isHost ? 'Game options' : 'View game options'">
                    <template>
                        <i class="fas fa-edit" slot="icon" v-if="isHost"></i>
                        <i class="far fa-question-circle" slot="icon" v-else></i>
                    </template>
                </vButton>
            </div>
        </div>
        <div class="users-wrapper">
          <div class="tab-switcher" >
            <div v-for="(value, key) in tabs"
                 @click="openTab(key)"
                 v-bind:key="key"
                 class="tab"
                 :class="{ activeTab: tab===key, [tab]: true }"
            >
              {{value}}
            </div>
          </div>
          <!-- <div class="row-wrapper"> -->
          <div v-if="tab === '0' || !tab"> <!--Users tab-->
            <table>
              <thead>
              <tr class="pin-row">
                <th class="users-name">
                  <span>Name</span>
                  <img v-if="!sortByUser" title="sort by name" alt="Sort by name" class="users-sort" src="/sort_by_icon.svg" @click="sortUser()"/>
                  <img v-if="sortByUser" title="Sort by oldest to newest" alt="Sort by oldest to newest" class="users-sort" src="/sort_by_icon_active.svg" @click="sortUser()"/>
                </th>
                <th>Seed</th>
                <th>State</th>
                <th v-if="isHost">Actions</th>
              </tr>
              </thead>
              <tbody class="users-rows">
              <!-- <tbody> -->
              <tr v-for="user in users" :key="user.userId">
                <td>{{ user.name }}</td>
                <td>
                  <span v-if="user.seed">{{ user.seed }}</span>
                  <span v-else class="muted">&mdash;</span>
                </td>
                <td>
                  <vUserTooltip :userId="user.userId"></vUserTooltip>
                </td>
                <td v-if="isHost && user.userId !== userId">
                  <div class="row-actions">
                    <vButton @click="kick(user.userId)" size="btn-small" title="Remove from the room (they can rejoin)">
                      <i class="fas fa-times" slot="icon"></i>
                      Kick
                    </vButton>
                    <vButton @click="ban(user.userId)" size="btn-small" title="Remove from the room for good">
                      <i class="fas fa-ban" slot="icon"></i>
                      Ban
                    </vButton>
                  </div>
                </td>
                <td v-else-if="isHost">
                  <div class="row-actions">
                    <vButton @click="startRun(false)" size="btn-small" class="btn-primary" title="Start the run for everyone who is ready">
                      <i class="fas fa-play" slot="icon"></i>
                      Start Run
                    </vButton>
                    <!-- asks for a second click instead of a popup; moving away or waiting cancels -->
                    <vButton
                      v-if="runInProgress"
                      @click="endRunClick"
                      @mouseleave.native="cancelEndRun"
                      size="btn-small"
                      class="end-run"
                      :class="{ 'btn-danger': confirmEnd }"
                      :title="confirmEnd ? 'Click again to end the run for everyone' : 'End the run for everyone'"
                    >
                      <i class="fas" :class="confirmEnd ? 'fa-exclamation-triangle' : 'fa-stop'" slot="icon"></i>
                      {{ confirmEnd ? "Really end?" : "End Run" }}
                    </vButton>
                  </div>
                </td>
              </tr>
              </tbody>
            </table>
          </div>
          <div v-if="tab === '1'"> <!--Mods tab-->
            <table>
              <thead>
              <tr>
                <th class="tablist-row-top">
                  <div class="tablist-arrow-spacing"/>
                  <div class="tablist-col">Mod Name</div>
                  <div class="tablist-col-smol">Users</div>
                </th>
              </tr>
              </thead>
              <tbody>
                <tr v-for="mod in modList" :key="mod.name">
                  <td>
                    <div class="tablist-row" @click="toggleCollapse(mod.name)">
                      <i title="click to see users"
                          class="fas"
                          slot="icon"
                          :class="expandedItem === mod.name ? 'fa-chevron-up tablist-arrow-up' : 'fa-chevron-down tablist-arrow-down'"
                      />
                      <div class="tablist-col">{{ `${ mod.name.substring(0, 150)}${mod.name.length>150?'...':''}` }}</div>
                      <div class="tablist-col-smol">{{ mod.users.length }}</div>
                    </div>
                    <div v-if="expandedItem === mod.name">
                      <table class="tablist-users-table">
                        <tbody>
                        <tr v-for="user in mod.users" :key="user">
                          <vModUserTooltip :userId="user"></vModUserTooltip>
                        </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="tab === '2'"> <!--Seeds tab-->
            <table>
              <thead>
              <tr>
                <th class="tablist-row-top">
                  <div class="tablist-arrow-spacing"/>
                  <div class="tablist-col">Seed</div>
                  <div class="tablist-col-smol">Users</div>
                </th>
              </tr>
              </thead>
              <tbody>
                <tr v-for="seed in seedList" :key="seed.name">
                  <td>
                    <div class="tablist-row" @click="toggleCollapse(seed.name)">
                      <i title="click to see users"
                          class="fas"
                          slot="icon"
                          :class="expandedItem === seed.name ? 'fa-chevron-up tablist-arrow-up' : 'fa-chevron-down tablist-arrow-down'"
                      />
                      <div class="tablist-col">{{ seed.name }}</div>
                      <div class="tablist-col-smol">{{ seed.users.length }}</div>
                    </div>
                    <div v-if="expandedItem === seed.name">
                      <table class="tablist-users-table">
                        <tbody>
                        <tr v-for="user in seed.users" :key="user">
                          <td>{{ user }}</td>
                        </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="chat-wrapper">
            <div class="chatbox" @keydown="sendChat">
                <vChatAutocomplete :items="autoData" v-model="chatMsg"></vChatAutocomplete> 
                <!-- <vChatAutocomplete :items="fakeUsernames" v-model="chatMsg"></vChatAutocomplete>  -->
            </div>
            <div class="room-chat" ref="chat" @scroll="handleScroll()">
                <template v-if="chat.length > 0">
                    <div v-for="(entry, index) in chat" :key="index" :class="entry.class">
                        <div class="chat-text-block">
                            <span class="chat-time" :style="{ color: entry.userId === '-1' ? entry.color : '#fff'}">[{{ entry.time }}]</span>
                            <span class="chat-name" :style="{ color: entry.color }">{{ entry.name }}</span>
                            <span class="chat-message" v-for="(span,j) in entry.spans" :key="j" :style="span.style">{{ span.message }}</span>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script>
import { ipcRenderer, clipboard } from "electron"
import vButton from "@/components/vButton.vue"
import vRoomFlags from "@/components/vRoomFlags.vue"
import vLeaveRoom from "@/components/vLeaveRoom.vue"
import vPlayerLimitDialog from "@/components/vPlayerLimitDialog.vue"
//import vTooltip from "@/components/vTooltip.vue"
import vUserTooltip from "@/components/vUserTooltip.vue"
import vChatAutocomplete from "@/components/vChatAutocomplete.vue"
import vModUserTooltip from "@/components/vModUserTooltip.vue"
export default {
    components: {
        vButton,
        vRoomFlags,
        //vTooltip,
        vUserTooltip,
        vModUserTooltip,
        vChatAutocomplete,
        vLeaveRoom,
        vPlayerLimitDialog
    },
    data() {
        return {
            showRoomFlags: false,
            showLeaveModal: false,
            showLimitModal: false,
            expandedContent: "",
            sortByUser: false,
            shouldScroll: true,
            chatMsg: "",
            lastMsg: Date.now(),
            locked: false,
            copied: false,
            confirmEnd: false,
            confirmEndAt: 0,
            confirmEndTimer: null,
            lockedTitle: "Room is locked: no one new can join. Click to unlock.",
            unlockedTitle: "Lock the room so no one new can join"
        }
    },
    beforeCreate() {
        const unsub = this.$store.subscribe((mutation) => {
            if (mutation.type == "resetRoom") {
                unsub()
                this.$router.replace({ path: "/lobby" })
            }
        })
    },
    created() {
        ipcRenderer.send("game_listen")
    },
    beforeDestroy() {
        clearTimeout(this.confirmEndTimer)
    },
    watch: {
        chat() {
            this.$nextTick(() => {
                if (this.shouldScroll) {
                  this.scrollToBottom();
                }
            })
        },
    },
    computed: {
        room() {
            return this.$store.state.room
        },
        lobbyCode() {
            return this.$store.state.lobbyCode
        },
        gamemodeName() {
            return this.$store.state.gamemodes[this.room.gamemode] || "Unknown mode"
        },
        noitaState() {
            if (this.$store.state.noitaConnected) return "connected"
            if (this.$store.state.noitaLaunched) return "starting"
            return "idle"
        },
        noitaLabel() {
            return { connected: "Noita connected", starting: "Starting Noita...", idle: "Start Noita" }[this.noitaState]
        },
        noitaTitle() {
            if (this.noitaState === "connected") return "Noita is running with the mod and connected to this room."
            if (this.noitaState === "starting") return "Waiting for Noita to load the mod and connect."
            return "Start Noita. (Steam's Play button doesn't work while Noita Together is open.)"
        },
        flags() {
            return this.$store.state.roomFlags
        },
        chat() {
            return this.$store.state.roomChat
        },
        userId() {
            return this.$store.getters.userId
        },
        runInProgress() {
            return this.$store.state.runInProgress
        },
        isHost() {
            return this.$store.getters.isHost
        },
        clientUser() {
            return this.$store.state.user
        },
        autoData() {
            return [{
                prefix: "@",
                names: this.$store.state.room.users.map(user => '@'+user.name),
            },
            {
                prefix: ":",
                names: this.modList.map(mod => ':'+mod.name.replace(/\s/g,'_')),
            }]
        },
        users() {
            const data = [
                ...this.$store.state.room.users
            ]
            if(!this.sortByUser) return data
            return [data[0], ...data.slice(1).sort((a, b) => {
              if(!a.name) return 1
              if(!b.name) return -1
              return a.name.toLowerCase() >= b.name.toLowerCase() ? 1 : -1
            })]
        },
        expandedItem(){
          return this.expandedContent
        },
        modList(){
            const mods = {}
            this.$store.state.room.users.forEach(user=>{
            //   console.log(user)
              const userMods = user.mods ? user.mods : []
              userMods.forEach(mod=>{
                if(!Object.keys(mods).includes(mod))
                  mods[mod] = []
                mods[mod].push(user.userId)
              })
            })

            const modNames = Object.keys(mods)
            return modNames.map((modName)=>({
              name: modName,
              users: mods[modName]
            })).sort((a,b)=>{
              const aUsers = a.users.length
              const bUsers = b.users.length

              if(aUsers === bUsers){
                return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1
              }
              return aUsers > bUsers ? -1 : 1
            })
        },
        seedList(){
            const seeds = {}
            this.$store.state.room.users.forEach(user=>{
                // console.log(user)
                const userSeed = user.seed ? user.seed : "Not Ready"
                if(!Object.keys(seeds).includes(userSeed))
                    seeds[userSeed] = []
                seeds[userSeed].push(user.name)
            })

            const seedNums = Object.keys(seeds)
            return seedNums.map((seedNum)=>({
                name: seedNum,
                users: seeds[seedNum]
            })).sort((a,b)=>{
                const aUsers = a.users.length
                const bUsers = b.users.length

                if(aUsers === bUsers){
                    return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1
                }
                return aUsers > bUsers ? -1 : 1
            })
        },
        tab(){
            return this.$store.state.roomTab
        },
        tabs(){
            return this.$store.state.tabs
        }
    },
    methods: {
        handleScroll() {
            const chatBox = this.$refs.chat;
            const scrollTop = chatBox.scrollTop;
            const scrollHeight = chatBox.scrollHeight;
            const clientHeight = chatBox.clientHeight;
            const scrollThreshold = 100; // Adjust the threshold as needed

            this.shouldScroll = scrollHeight - scrollTop - clientHeight < scrollThreshold;
        },
        scrollToBottom() {
            this.$refs.chat.scrollTop = this.$refs.chat.scrollHeight;
        },
        copyInviteCode() {
            clipboard.writeText(this.lobbyCode)
            this.copied = true
            setTimeout(() => { this.copied = false }, 1500)
        },
        setPlayerLimit(maxUsers) {
            this.showLimitModal = false
            if (maxUsers !== this.room.maxUsers) this.$store.dispatch("updateRoom", { maxUsers })
        },
        startNoita() {
            ipcRenderer.send("launch_noita")
        },
        lockRoom() {
            this.$store.dispatch("updateRoom", { locked: !this.room.locked })
        },
        setTab(tab) {
            this.$store.dispatch("updateTab", tab)
        },
        sendChat(e) {
            if (e.key != "Enter" || !this.chatMsg.trim()) {
                return
            }
            if (Date.now() - this.lastMsg < 400) {
                this.$store.dispatch("sendClientAlert", { message: "You're sending messages too fast." })
                return
            }
            if(this.chatMsg.length > 500){
              this.$store.dispatch("sendClientAlert", { message: "That message is too long. Keep it under 500 characters." })
              return
            }
            this.$store.dispatch("sendChat", { message: this.chatMsg.trim() })
            this.lastMsg = Date.now()
            this.chatMsg = ""
        },
        sendFlags(payload) {
            this.$store.commit("cRoomFlagsUpdated", payload)
            this.$store.dispatch("sendFlags")
            this.closeRoomFlags()
        },
        openRoomFlags() {
            this.showRoomFlags = true
        },
        closeRoomFlags() {
            this.showRoomFlags = false
        },
        openLeaveRoom() {
            this.showLeaveModal = true
        },
        toggleCollapse(name){
            this.expandedContent = this.expandedContent === name ? "" : name
        },
        openTab(tab){
            this.setTab(tab)
        },
        sortUser(){
          this.sortByUser = !this.sortByUser
        },
        closeLeaveModal() {
            this.showLeaveModal = false
        },
        kick(userId) {
            this.$store.dispatch("kickUser", { userId })
        },
        ban(userId) {
            this.$store.dispatch("banUser", { userId })
        },
        endRunClick() {
            if (!this.confirmEnd) {
                this.confirmEnd = true
                this.confirmEndAt = Date.now()
                clearTimeout(this.confirmEndTimer)
                this.confirmEndTimer = setTimeout(this.cancelEndRun, 4000)
                return
            }
            // the second click of a double-click doesn't count as confirming
            if (Date.now() - this.confirmEndAt < 400) return
            this.cancelEndRun()
            this.$store.dispatch("endRun")
        },
        cancelEndRun() {
            clearTimeout(this.confirmEndTimer)
            this.confirmEnd = false
        },
        startRun(forced) {
            this.$store.dispatch("startRun", { forced })
        }
    },
}
</script>

<style>
.room-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 3.2em;
    margin-bottom: 0.5em;
}

.room-title {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6em;
}

.room-title > h1 {
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.room-mode {
    flex-shrink: 0;
    padding: 0.2em 0.6em;
    border-radius: 1em;
    background: #2e2e2e;
    font-size: 0.85em;
    color: rgba(255, 255, 255, 0.7);
    white-space: nowrap;
}

.room-mode.mode-2 {
    background: #4a2a2a;
    color: #f0b4b4;
}

.room-count {
    flex-shrink: 0;
    padding: 0.2em 0.6em;
    background: #2e2e2e;
    border: 1px solid transparent;
    border-radius: 1em;
    color: inherit;
    font: inherit;
    font-size: 0.95em;
    white-space: nowrap;
    cursor: default;
}

.room-count.editable {
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
}

.room-count.editable:hover {
    border-color: #6a6a6a;
    background: #363636;
}

.room-count > .room-count-edit {
    margin: 0 0 0 0.5em;
    font-size: 0.7em;
    opacity: 0.4;
}

.room-count.editable:hover > .room-count-edit {
    opacity: 0.8;
}

.room-count > i {
    margin-right: 0.4em;
    font-size: 0.8em;
    opacity: 0.6;
}

.noita-button {
    white-space: nowrap;
}

.noita-button > i {
    margin-right: 0.45em;
}

.noita-button.noita-on,
.noita-button.noita-on:disabled {
    background-color: #2f4a2c;
    color: #b9e0b2;
    opacity: 1;
}

.invite-chip {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    padding: 0 0.9em;
    background: #2e2e2e;
    border: 1px dashed #5a5a5a;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.2s, background-color 0.2s;
}

.invite-chip:hover {
    background: #383838;
    border-color: #9a9a9a;
}

.invite-chip:focus {
    outline: none;
}

.invite-chip.copied {
    border-color: #7fbf5f;
}

.invite-label {
    font-size: 0.7em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
}

.invite-chip.copied .invite-label,
.invite-chip.copied .invite-code > i {
    color: #9fdf7f;
}

.invite-code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 1.05em;
    white-space: nowrap;
}

.invite-code > i {
    margin-right: 0.35em;
    font-size: 0.85em;
    opacity: 0.7;
}

.row-actions {
    display: flex;
    gap: 4px;
}

.end-run {
    min-width: 8.6em;
}

.row-actions > .btn,
.users-rows .btn-primary {
    white-space: nowrap;
}

.muted {
    color: rgba(255, 255, 255, 0.35);
}

/* narrow window: give the room name more space */
@media only screen and (max-width: 700px) {
    .invite-label {
        display: none;
    }
    .invite-chip {
        padding: 0 0.6em;
    }
    .noita-button-text {
        display: none;
    }
    .noita-button > i {
        margin-right: 0;
    }
    .room-title > h1 {
        font-size: 1.5em;
    }
}

.users-wrapper {
    width: 100%;
    margin-bottom: 1em;
    overflow: auto;
    overflow-x: hidden;
}

.users-name{
    display: flex;
}

.users-sort{
    cursor: pointer;
    margin-left: 8px;
    width: 20px;
    height: 20px;
    object-fit: contain;
}

.tab-switcher{
    display: flex;
    overflow: hidden;
    position: sticky;
    top: 0;
    background: #1d1d1d;
}

.tab{
    margin-right: 2px;
    padding: 6px 14px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.55);
    user-select: none;
}

.tab:hover{
    background: #262626;
    color: rgba(255, 255, 255, 0.8);
}

.activeTab{
    background: #2e2e2e !important;
    color: rgba(255, 255, 255, 0.95);
    box-shadow: inset 0 2px 0 #8a8a8a;
}

.tablist-row-top{
    width: 100%;
    justify-content: space-between;
    display: flex;
    position: sticky;
    top: 1.6em;
}

.pin-row > th{
    position: sticky;
    top: 1.6em
}

.users-rows tr:first-child > td{
    top: 4.4em;
    background-color: #1D1D1D;
}

.tablist-row{
    width: 100%;
    justify-content: space-between;
    display: flex;
}

.tablist-col{
    width: 80%;
}

.tablist-col-smol{
    width: 20%;
    justify-content: center;
    text-align: center;
}

.tablist-users-table{
    border: 1px solid #2E2E2E;
    width: 60%;
    margin-top: 8px;
    margin-left: 32px;
}

.tablist-arrow-spacing{
    width: 20px;
}

.tablist-arrow-down{
    margin-right: 8px;
}

.tablist-arrow-up{
    margin-right: 8px;
}

.room-edit {
    display: flex;
    gap: 6px;
    height: 100%;
    flex-shrink: 0;
}

.chatbox {
    display: flex;
    width: 100%;
}

.chat-wrapper {
    display: flex;
    flex-direction: column-reverse;
    width: 100%;
    max-height: 40%;
    min-height: 40%;
    margin-top: auto;
}
.room-chat {
    padding: 0.5em;
    background: rgb(40, 40, 40);
    display: flex;
    flex-direction: column;
    overflow-wrap: break-word;
    overflow: auto;
    overflow-x: hidden;
    height: 100%;
}

.chat-entry {
    padding: 0.25em 0.1em;
}

.chat-text-block {
    overflow-y: hidden;
}

.chat-entry:hover {
    background: rgba(58, 58, 58, 0.5);
}
.mention {
    margin-bottom: 0.2em;
    padding: 0.2em 0.1em;
    border: 0.1em solid gold;
    box-sizing: border-box;
}

.mention:hover {
    background: rgba(58, 58, 58, 0.5); 
}

.chat-entry > p {
    display: inline-block;
}

.chat-time {
    font-weight: 500;
    margin-right: 0.3em;
}

.chat-name {
    font-weight: 600;
    margin-right: 0.3em;
}
.chat-name::after {
    content: ":";
}

@media only screen and (min-width: 900px) {
    .room-header {
        flex-shrink: 0;
    }
    .chat-wrapper {
        display: flex;
        margin: 0;
        flex-direction: column-reverse;
        width: 50%;
        max-height: 90%;
        height: 90%;
        margin-left: auto;
    }

    .users-wrapper {
        width: 50%;
        max-height: 90%;
        margin-bottom: 0;
    }

    #room {
        flex-flow: row wrap;
    }
}

.user-ready {
    color: #acff2f;
}

.user-not-ready {
    color: #ff2f2f;
}

.users-wrapper table td:nth-child(1n + 0) {
    width: 40%;
}

.users-wrapper table td:nth-child(2n + 0) {
    width: 15%;
}

.users-wrapper table td:nth-child(3n + 0) {
    width: 15%;
    white-space: nowrap;
}
.users-wrapper table td:nth-child(4n + 0) {
    width: 30%;
}
</style>