<template>
    <div class="footer">
        <span id="app-version">v{{version}}</span>
        <vSwitch
            :key="switchKey"
            :value="autoUpdate"
            :disabled="saving"
            class="footer-auto-update"
            title="On: new versions download and install by themselves. Off: the app tells you when a new version is out and you choose when to get it."
            @input="setAutoUpdate"
        >
            <span>Auto-update</span>
        </vSwitch>
        <span class="donate" @click="ShowHelpInBrowser">
          <span>FAQ <i slot="icon" class="fas fa-link"></i></span>
        </span>
        <div class="donate" @click="OpenContributors">
            <span title="Github">Click to see contributors <i slot="icon" class="fas fa-wrench"></i></span>
        </div>
    </div>
</template>

<script>
import { shell, remote, ipcRenderer } from "electron";
import vSwitch from "./vSwitch.vue";
export default {
    name: "vFooter",
    components: { vSwitch },
    beforeMount() {
        this.version = remote.app.getVersion()
    },
    data() {
        return {
            contributorUrl: "https://github.com/Noita-Together/noita-together/",
            faqUrl: "https://github.com/Noita-Together/noita-together/wiki/FAQ",
            version: "0",
            saving: false,
            switchKey: 0
        }
    },
    computed: {
        autoUpdate() {
            return this.$store.state.update.autoUpdate
        }
    },
    methods: {
        OpenContributors() {
            shell.openExternal(this.contributorUrl);
        },
        ShowHelpInBrowser() {
            shell.openExternal(this.faqUrl);
        },
        async setAutoUpdate(on) {
            this.saving = true
            try {
                const state = await ipcRenderer.invoke("set_auto_update", on)
                this.$store.commit("setUpdateState", state)
            } finally {
                this.saving = false
                // if saving failed the store didn't change, so redraw the switch to match it
                if (this.autoUpdate !== on) this.switchKey++
            }
        },
    }
};
</script>

<style>
.footer {
    display: flex;
    align-items: center;
    min-height: 32px;
    max-height: 32px;
    background-color: #2d2d2d;
}

#app-version {
    color: rgba(255, 255, 255, 0.4);
    margin-left: 0.5em;
}

.footer-auto-update {
    display: flex;
    align-items: center;
    margin-left: 0.8em;
    margin-right: auto;
}

.footer-auto-update > span {
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.9em;
}

.donate {
    cursor: pointer;
    margin-left: auto;
    margin-right: 0.5em;
}

.donate span, .donate span > i {
    color: rgba(255, 255, 255, 0.4);
}

.donate:hover *{
    color:white;
    transform: scale(1.2, 1.2);
    transition: all 0.2s;
}
</style>