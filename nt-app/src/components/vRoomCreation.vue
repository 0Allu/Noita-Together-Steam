<template>
    <vModal size="medium">
        <h1 slot="header" class="dialog-title">
            <i class="fas fa-plus-square dialog-icon"></i>
            Create Room
        </h1>
        <form slot="body" class="form" @submit.prevent="createRoom">
            <div class="form-field">
                <label class="form-label" for="room-name">Room name</label>
                <label class="field" :class="{ invalid: nameError }">
                    <i class="fas fa-home"></i>
                    <input id="room-name" ref="name" v-model="name" maxlength="32" spellcheck="false" />
                </label>
                <span v-if="nameError" class="form-error">{{ nameError }}</span>
            </div>

            <div class="form-row">
                <div class="form-field">
                    <label class="form-label" for="room-mode">Game mode</label>
                    <select id="room-mode" class="slot-selector" v-model.number="gamemode">
                        <option :value="0">Co-op</option>
                        <option :value="2">Nemesis (prototype)</option>
                    </select>
                </div>
                <div class="form-field">
                    <label class="form-label" for="room-slots">Max players</label>
                    <vPlayerLimit input-id="room-slots" v-model="maxUsers" />
                    <span v-if="maxUsersError" class="form-error">{{ maxUsersError }}</span>
                </div>
            </div>

            <div class="form-field">
                <span class="form-label">Who can find it</span>
                <div class="choice-group">
                    <label class="choice" :class="{ selected: visibility === 'public' }">
                        <input type="radio" value="public" v-model="visibility" />
                        <i class="fas fa-globe"></i>
                        <span>
                            <span class="choice-title">Public</span>
                            <span class="choice-desc">Listed in everyone's room list</span>
                        </span>
                    </label>
                    <label class="choice" :class="{ selected: visibility === 'private' }">
                        <input type="radio" value="private" v-model="visibility" />
                        <i class="fas fa-key"></i>
                        <span>
                            <span class="choice-title">Invite only</span>
                            <span class="choice-desc">Hidden; join with the invite code</span>
                        </span>
                    </label>
                </div>
            </div>

            <div class="form-field">
                <label class="form-label" for="room-password">Password <span class="optional">(optional)</span></label>
                <label class="field" :class="{ invalid: passwordError }">
                    <i class="fas fa-lock"></i>
                    <input
                        id="room-password"
                        v-model="password"
                        maxlength="50"
                        placeholder="No password"
                        spellcheck="false"
                    />
                </label>
                <span v-if="passwordError" class="form-error">{{ passwordError }}</span>
            </div>
            <!-- lets Enter submit the form -->
            <button type="submit" hidden></button>
        </form>
        <div slot="footer" class="dialog-actions">
            <vButton @click="close">Cancel</vButton>
            <vButton class="btn-primary" @click="createRoom" :disabled="!canCreate">Create</vButton>
        </div>
    </vModal>
</template>

<script>
import vModal from "../components/vModal.vue";
import vButton from "../components/vButton.vue";
import vPlayerLimit, { playerLimitError } from "../components/vPlayerLimit.vue";

// the room host rejects anything else (see steam/hostRoom.js)
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

export default {
    name: "vRoomCreation",
    components: {
        vButton,
        vModal,
        vPlayerLimit,
    },
    data() {
        return {
            name: `${this.$store.state.user.name}'s Room`,
            gamemode: 0,
            maxUsers: 5,
            visibility: "public",
            password: "",
        };
    },
    mounted() {
        this.$refs.name.focus();
        this.$refs.name.select();
    },
    computed: {
        maxUsersError() {
            return playerLimitError(this.maxUsers);
        },
        nameError() {
            const name = this.name.trim();
            if (!name) return "Give the room a name.";
            if (name.length > 32) return "Keep it under 32 characters.";
            if (!PRINTABLE_ASCII.test(name)) return "Use plain letters, numbers and symbols (no emoji or accents).";
            return "";
        },
        passwordError() {
            if (!PRINTABLE_ASCII.test(this.password)) return "Use plain letters, numbers and symbols (no emoji or accents).";
            return "";
        },
        canCreate() {
            return !this.nameError && !this.passwordError && !this.maxUsersError;
        },
    },
    methods: {
        createRoom() {
            if (!this.canCreate) return;
            this.$emit("createRoom", {
                name: this.name.trim(),
                gamemode: this.gamemode,
                password: this.password,
                maxUsers: this.maxUsers,
                visibility: this.visibility,
            });
        },
        close() {
            this.$emit("close");
        },
    },
};
</script>

<style>
</style>
