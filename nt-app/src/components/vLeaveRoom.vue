<template>
    <vModal size="small">
        <h1 slot="header" class="dialog-title">
            <i class="fas fa-door-open dialog-icon" :class="{ danger: isHost }"></i>
            {{ isHost ? "Close the room?" : "Leave the room?" }}
        </h1>
        <template slot="body">
            <p class="dialog-text" v-if="isHost">
                You're the host, so leaving closes the room for everyone and the item bank is lost.
            </p>
            <p class="dialog-text" v-else>You can rejoin later if the room is still open.</p>
        </template>
        <div slot="footer" class="dialog-actions">
            <vButton @click="close">Stay</vButton>
            <vButton class="btn-danger" @click="leaveRoom">{{ isHost ? "Close room" : "Leave" }}</vButton>
        </div>
    </vModal>
</template>

<script>
import vModal from "../components/vModal.vue";
import vButton from "../components/vButton.vue";
export default {
    name: "vLeaveRoom",
    components: {
        vButton,
        vModal
    },
    computed: {
        isHost() {
            return this.$store.getters.isHost;
        },
    },
    methods: {
        leaveRoom() {
            this.$store.dispatch("leaveRoom");
        },
        close() {
            this.$emit("close");
        }
    },
};
</script>

<style>
</style>