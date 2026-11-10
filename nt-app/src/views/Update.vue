<template>
    <div class="content">
        <vGamePath v-if="showPathModal" @setPath="setPathAndUpdate"></vGamePath>
        <h1 class="dialog-title update-title">
            <i class="fas fa-check-circle dialog-icon update-ok" v-if="success"></i>
            <i class="fas fa-exclamation-triangle dialog-icon warn" v-else-if="done"></i>
            <i class="fas fa-spinner fa-pulse dialog-icon" v-else></i>
            <template v-if="success">Mod is ready</template>
            <template v-else-if="done">Couldn't update the mod</template>
            <template v-else>Checking the Noita Together mod...</template>
        </h1>
        <div class="update-log" ref="log">
            <p v-for="(msg, index) in logs" :key="index">{{ msg }}</p>
        </div>
        <div class="update-actions">
            <template v-if="done && !success">
                <vButton @click="retry">
                    <i class="fas fa-redo" slot="icon"></i>
                    Retry
                </vButton>
                <vButton @click="ContinueLogin" title="Use the mod version that's already installed">Continue anyway</vButton>
            </template>
            <vButton v-else class="btn-primary" :disabled="!success" @click="ContinueLogin">
                Continue
                <i class="fas fa-arrow-right"></i>
            </vButton>
        </div>
    </div>
</template>

<script>
import { ipcRenderer } from "electron";
import vButton from "@/components/vButton.vue";
import vGamePath from "@/components/vGamePath.vue";
export default {
    components: { vButton, vGamePath},
    data() {
        return {
            logs: [],
            success: false,
            done: false,
            showPathModal: false
        };
    },
    beforeCreate() {
        ipcRenderer.on("update_log", (event, data) => {
            this.logs.push(data);
        });

        ipcRenderer.on("update_done", (event, data) => {
            this.success = data;
            this.done = true;
        });

        ipcRenderer.on("GAME_PATH_NOT_FOUND", () => {
            this.showPathModal = true
        })

        ipcRenderer.on("skip_update", () => {
            this.$router.replace({ path: "/login" })
        })
    },
    created() {
        ipcRenderer.send("update_mod")
    },
    methods: {
        ContinueLogin() {
            this.$router.replace({ path: "/login" });
        },
        setPathAndUpdate(path) {
            this.showPathModal = false
            this.done = false
            ipcRenderer.send("update_mod", path)
        },
        retry() {
            this.done = false
            this.logs.push("Retrying...")
            ipcRenderer.send("update_mod")
        }
    },
};
</script>

<style>
.update-title {
    margin: 0.4em 0 0.7em;
}

.update-ok {
    color: #7fbf5f;
}

.update-log {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overflow-x: hidden;
    padding: 0.6em 0.8em;
    background: #161616;
    border: 1px solid #2e2e2e;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.9em;
}

.update-log > p {
    margin: 0.25em 0;
    font-family: inherit;
    font-size: inherit;
    color: rgba(255, 255, 255, 0.7);
}

.update-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 0.8em 0;
}
</style>