<template>
    <vModal size="small">
        <h1 slot="header" class="dialog-title">
            <i class="fas dialog-icon" :class="optional ? 'fa-sign-in-alt' : 'fa-lock'"></i>
            {{ optional ? "Join with invite code" : "Password needed" }}
        </h1>
        <form slot="body" class="form" @submit.prevent="join">
            <p class="dialog-text" v-if="optional">
                Joining <span class="code">{{ id }}</span>. If the room has a password, enter it here.
            </p>
            <p class="dialog-text" v-else>This room is protected. Ask the host for the password.</p>
            <div class="form-field">
                <label class="form-label" for="join-password">
                    Password <span v-if="optional" class="optional">(leave empty if there is none)</span>
                </label>
                <label class="field">
                    <i class="fas fa-key"></i>
                    <input id="join-password" ref="input" v-model="password" spellcheck="false" />
                </label>
            </div>
            <button type="submit" hidden></button>
        </form>
        <div slot="footer" class="dialog-actions">
            <vButton @click="close">Cancel</vButton>
            <vButton class="btn-primary" @click="join" :disabled="!optional && !password">Join</vButton>
        </div>
    </vModal>
</template>

<script>
import vModal from "../components/vModal.vue";
import vButton from "../components/vButton.vue";
export default {
    name: "vRoomPassword",
    components: {
        vButton,
        vModal,
    },
    props: {
        id: {
            type: String,
            required: true,
        },
        optional: {
            type: Boolean,
            required: false,
        },
    },
    data() {
        return {
            password: "",
        };
    },
    mounted() {
        this.$refs.input.focus();
    },
    methods: {
        join() {
            if (!this.optional && !this.password) return;
            this.$emit("join", this.id, this.password);
        },
        close() {
            this.password = "";
            this.$emit("close");
        },
    },
};
</script>

<style>
</style>
