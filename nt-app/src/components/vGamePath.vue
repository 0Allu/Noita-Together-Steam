<template>
    <vModal size="medium">
        <h1 slot="header" class="dialog-title">
            <i class="fas fa-folder-open dialog-icon warn"></i>
            Where is Noita installed?
        </h1>
        <div slot="body" class="form">
            <p class="dialog-text">
                Pick the folder that contains <span class="code">noita.exe</span> so the mod can be installed.
                In Steam: right-click Noita, Manage, Browse local files.
            </p>
            <div class="field-row">
                <label class="field" :class="{ invalid: error }">
                    <i class="fas fa-folder"></i>
                    <input :value="gamePath" placeholder="No folder selected" readonly />
                </label>
                <vButton size="btn-field" @click="browseDialog">Browse</vButton>
            </div>
            <span v-if="error" class="form-error">{{ error }}</span>
        </div>
        <div slot="footer" class="dialog-actions">
            <vButton class="btn-primary" @click="setPath" :disabled="!canUpdate">Install mod</vButton>
        </div>
    </vModal>
</template>

<script>
import vModal from "../components/vModal.vue";
import vButton from "../components/vButton.vue";
import { remote } from "electron";
import path from "path";
import fs from "fs";

export default {
    name: "vGamePath",
    components: {
        vButton,
        vModal,
    },
    data() {
        return {
            gamePath: "",
            error: "",
            canUpdate: false,
        };
    },
    methods: {
        setPath() {
            this.$emit("setPath", this.gamePath);
        },
        browseDialog() {
            remote.dialog
                .showOpenDialog({ properties: ["openDirectory"] })
                .then((res) => {
                    if (res.filePaths.length > 0) {
                        const gamePath = res.filePaths.shift();
                        this.gamePath = gamePath;
                        if (fs.existsSync(path.join(gamePath, "/noita.exe"))) {
                            this.error = "";
                            this.canUpdate = true;
                        } else {
                            this.canUpdate = false;
                            this.error = "There's no noita.exe in that folder.";
                        }
                    }
                });
        },
    },
};
</script>

<style>

</style>