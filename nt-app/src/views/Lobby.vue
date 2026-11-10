<template>
    <div class="content">
        <vRoomCreation
            v-if="showRoomCreation"
            @createRoom="createRoom"
            @close="closeCreationModal"
        />
        <vRoomPassword
            v-if="showPasswordModal"
            :id="clickedRoom"
            :optional="passwordOptional"
            @join="joinRoom"
            @close="closePasswordModal"
        />
        <div class="lobby-header">
            <h1>Rooms</h1>
            <div class="lobby-actions">
                <vButton @click="openRoomCreation">
                    <template slot="icon">
                        <i class="fas fa-plus-square"></i>
                    </template>
                    Create
                </vButton>
                <vButton @click="refreshRooms" title="Refresh the room list">
                    <template slot="icon">
                        <i
                            class="fas fa-spinner fa-spin fa-pulse"
                            v-if="refreshing"
                        ></i>
                        <i class="fas fa-sync" v-else></i>
                    </template>
                    Refresh
                </vButton>
            </div>
        </div>
        <div class="lobby-toolbar">
            <label class="field lobby-filter">
                <i class="fas fa-search"></i>
                <input v-model="roomFilter" placeholder="Filter by room or owner" spellcheck="false" />
            </label>
            <form class="join-code" @submit.prevent="joinByCode">
                <label class="field">
                    <i class="fas fa-key"></i>
                    <input v-model="joinCode" placeholder="Invite code" spellcheck="false" />
                </label>
                <vButton size="btn-field" :disabled="!joinCode.trim()" title="Join a room with its invite code">
                    <template slot="icon">
                        <i class="fas fa-sign-in-alt"></i>
                    </template>
                    Join
                </vButton>
            </form>
        </div>

        <div class="lobbies-wrapper scroll-y">
            <table class="lobbies">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Owner</th>
                        <th>Mode</th>
                        <th>Users</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="filteredRooms.length == 0" class="no-rooms-row">
                        <td id="no-rooms" colspan="4">
                            <template v-if="rooms.length == 0">
                                No public rooms right now. Create one, or join a friend's room with their invite code.
                            </template>
                            <template v-else>No rooms match "{{ roomFilter }}".</template>
                        </td>
                    </tr>
                    <tr
                        v-else
                        v-for="room in filteredRooms"
                        :key="room.id"
                        class="room-row"
                        title="Double-click to join"
                        @dblclick="joinRoom(room.id, room.protected)"
                    >
                        <td>
                            <i class="fas fa-ban room-icon" v-if="room.locked" title="Locked: no one can join right now"></i>
                            <i class="fas fa-lock room-icon" v-if="room.protected" title="Needs a password"></i>
                            <span>{{ room.name }}</span>
                        </td>
                        <td>{{room.owner}}</td>
                        <td>{{ gamemode(room.gamemode) }}</td>
                        <td>{{ room.curUsers }}/{{ room.maxUsers }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script>
import vButton from "../components/vButton.vue";
import vRoomCreation from "../components/vRoomCreation.vue";
import vRoomPassword from "../components/vRoomPassword.vue";
export default {
    components: {
        vButton,
        vRoomCreation,
        vRoomPassword
    },
    data() {
        return {
            showPasswordModal: false,
            showRoomCreation: false,
            refreshing: false,
            clickedRoom: "",
            passwordOptional: false,
            roomFilter: "",
            joinCode: ""
        };
    },
    beforeCreate() {
        try {
            const unsub = this.$store.subscribe((mutation) => {
                if (mutation.type == "setRoom") {
                    unsub();
                    this.$router.replace({ path: "/room" });
                }
            });
            this.$store.dispatch("requestRooms");
        } catch (error) {
            console.log(error);
        }
    },
    computed: {
        rooms() {
            return this.$store.state.lobbies;
        },
        filteredRooms() {
            const filterKey = this.roomFilter && this.roomFilter.toLowerCase()
            let data = this.rooms
            data = data.filter(room => {
                return room.name.toLowerCase().includes(filterKey) || room.owner.toLowerCase().includes(filterKey)
            })

            return data
        }
    },
    methods: {
        openRoomCreation() {
            this.showRoomCreation = true;
        },
        closeCreationModal() {
            this.showRoomCreation = false;
        },
        openPasswordModal() {
            this.showPasswordModal = true;
        },
        closePasswordModal() {
            this.showPasswordModal = false;
        },
        joinByCode() {
            if (!this.joinCode.trim()) return;
            // invite codes don't say whether the room has a password, so always offer the field
            this.clickedRoom = this.joinCode.trim();
            this.passwordOptional = true;
            this.openPasswordModal();
        },
        joinRoom(id, password) {
            if (typeof password == "boolean" && password) {
                this.clickedRoom = id;
                this.passwordOptional = false;
                this.openPasswordModal();
                return;
            }
            this.closePasswordModal();
            try {
                this.$store.dispatch("joinRoom", {
                    id,
                    password: password ? password : undefined,
                });
            } catch (error) {
                console.log(error);
            }
        },
        gamemode(id) {
            return this.$store.state.gamemodes[id];
        },
        createRoom(payload) {
            this.$store.dispatch("createRoom", payload);
        },
        refreshRooms() {
            this.refreshing = true;
            try {
                const unsub = this.$store.subscribe((mutation) => {
                    if (mutation.type == "setRooms") {
                        this.refreshing = false;
                        unsub();
                    }
                });
                this.$store.dispatch("requestRooms");
            } catch (error) {
                console.log(error);
            }
        },
    },
};
</script>

<style>
.lobby-header {
    display: flex;
    align-items: center;
}

.lobby-header > h1 {
    margin: 0.4em 0;
}

.lobby-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
}

.lobby-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
}

.lobby-filter {
    flex: 1 1 auto;
    max-width: 320px;
}

.join-code {
    display: flex;
    margin: 0 0 0 auto;
}

.join-code .field {
    width: 170px;
    border-right: none;
}

.room-row {
    cursor: pointer;
}

.room-icon {
    margin-right: 0.45em;
    opacity: 0.75;
}

.lobbies-wrapper {
    max-height: 90%;
}

.lobbies-wrapper > thead {
    position: sticky;
}

.no-rooms-row:hover {
    background: none !important;
}

#no-rooms {
    width: 100%;
    text-align: center;
    padding: 2.5em 1em;
    color: rgba(255, 255, 255, 0.5);
}

.lobbies-wrapper table td:nth-child(1n + 0) {
    width: 50%;
}

.lobbies-wrapper table td:nth-child(2n + 0) {
    width: 25%;
}

.lobbies-wrapper table td:nth-child(3n + 0) {
    width: 25%;
}
</style>
