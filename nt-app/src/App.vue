<template>
    <div id="app" class="wrapper">
        <vHeader :title="title" />
        <div v-if="updateReady && !updateDismissed" class="update-banner">
            <i class="fas fa-arrow-circle-down"></i>
            <span class="update-text">
                Version {{ updateReady }} is ready. It installs when you close the app.
            </span>
            <button
                v-if="!inRoom"
                type="button"
                class="update-action"
                @click="installUpdate"
            >Restart now</button>
            <button
                type="button"
                class="update-close"
                title="Hide"
                @click="updateDismissed = true"
            >
                <i class="fas fa-times"></i>
            </button>
        </div>
        <router-view />
        <vFooter />

        <!-- the login button shows its own progress -->
        <vLoading v-if="loading && $route.path !== '/login'" />
        <vErrDialog v-if="showErrDialog">
            <h1 slot="header" class="dialog-title">
                <i class="fas fa-exclamation-triangle dialog-icon warn"></i>
                {{ errDialog.title }}
            </h1>
            <p slot="body">{{ errDialog.body }}</p>
            <div slot="footer" class="dialog-actions">
                <vButton class="btn-primary" @click="closeErrDialog" v-if="errDialog.canClose">OK</vButton>
                <p v-else class="restart-note">Please restart the app.</p>
            </div>
        </vErrDialog>
    </div>
</template>

<script>
import vHeader from "@/components/vHeader.vue";
import vFooter from "@/components/vFooter.vue";
import vLoading from "@/components/vLoading.vue";
import vErrDialog from "@/components/vErrDialog.vue";
import vButton from "@/components/vButton.vue";
import { ipcRenderer } from "electron";
export default {
    components: { vHeader, vFooter, vLoading, vErrDialog, vButton },
    data() {
        return {
            title: "Noita Together",
            updateDismissed: false,
        };
    },
    computed: {
        loading() {
            return this.$store.state.loading;
        },
        showErrDialog() {
            return this.$store.state.showErrDialog;
        },
        errDialog() {
            return this.$store.state.errDialog;
        },
        updateReady() {
            return this.$store.state.updateReady;
        },
        // restarting would close the room for everyone if we're hosting
        inRoom() {
            return !!this.$store.state.room.id;
        },
    },
    methods: {
        closeErrDialog() {
            this.$store.commit("showErrDialog", false);
        },
        installUpdate() {
            ipcRenderer.send("install_update");
        },
    },
};
</script>

<style>
* {
    font-size: 1rem;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.8);
    font-family: Helvetica, Arial, sans-serif;
}

body {
    overflow-y: hidden;
}

.update-banner + .content {
    margin-top: 0;
}

.update-banner {
    /* the header floats over the top 32px */
    margin-top: 32px;
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.45em 0.8em;
    background-color: #24412a;
    border-left: solid 2px #2d2d2d;
    border-right: solid 2px #2d2d2d;
    font-size: 0.9em;
}

.update-banner > i {
    color: #7fd18b;
}

.update-text {
    flex-grow: 1;
    font-size: 0.9em;
}

.update-action,
.update-close {
    border: none;
    cursor: pointer;
    font-size: 0.85em;
}

.update-action {
    padding: 0.3em 0.8em;
    background-color: #3a8a47;
    color: #fff;
}

.update-action:hover {
    background-color: #46a055;
}

.update-close {
    padding: 0.3em 0.4em;
    background: none;
    color: rgba(255, 255, 255, 0.6);
}

.update-close:hover {
    color: #fff;
}

.wrapper {
    display: flex;
    flex-flow: column;
    height: 100vh;
}

.content {
    display: flex;
    flex-grow: 1;
    flex-flow: column;
    background-color: #1d1d1d;
    border-left: solid 2px #2d2d2d;
    border-right: solid 2px #2d2d2d;
    padding: 0.3em 0.6em;
    overflow-y: auto;
    overflow-x: hidden;
    margin-top: 32px;
}

.centered {
    margin: auto;
}

/* boxed text input with an optional leading icon: <label class="field"><i/><input/></label> */
.field {
    display: flex;
    align-items: center;
    height: 34px;
    box-sizing: border-box;
    padding: 0 0.6em;
    background: #262626;
    border: 1px solid #3c3c3c;
    transition: border-color 0.2s;
}

.field:focus-within {
    border-color: #8a8a8a;
}

.field > i {
    opacity: 0.5;
    margin-right: 0.5em;
    font-size: 0.9em;
}

.field > input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.9);
}

.field > input::placeholder {
    color: rgba(255, 255, 255, 0.35);
}

.field > input:disabled {
    color: rgba(255, 255, 255, 0.45);
}

table {
    border-collapse: collapse;
    width: 100%;
    user-select: none;
}

table td,
table th {
    padding: 8px;
}

table tr:nth-child(even) {
    background-color: rgba(0, 0, 0, 0.3);
}

table tr:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

table td:nth-child(1n + 0) {
    width: 60%;
}

table td:nth-child(2n + 0) {
    width: 30%;
}

table td:nth-child(3n + 0) {
    width: 10%;
}

table th {
    padding-top: 12px;
    padding-bottom: 12px;
    text-align: left;
    background-color: #2e2e2e;
    color: rgba(255, 255, 255, 0.8);
}

::-webkit-scrollbar {
    width: 0.6em; /* width of the entire scrollbar */
}

::-webkit-scrollbar-track {
    background: #111111; /* color of the tracking area */
}

::-webkit-scrollbar-thumb {
    background-color: #696969; /* color of the scroll thumb */
}

/* dark dropdown, same height as .field */
.slot-selector {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.3;
    height: 34px;
    padding: 0 2em 0 0.7em;
    width: 100%;
    max-width: 100%;
    margin: 0;
    border: 1px solid #3c3c3c;
    -moz-appearance: none;
    -webkit-appearance: none;
    appearance: none;
    background-color: #262626;
    cursor: pointer;
    transition: border-color 0.2s;
    background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23aaaaaa%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75em top 50%;
    background-size: 0.6em auto;
}

.slot-selector:hover,
.slot-selector:focus {
    border-color: #8a8a8a;
    outline: none;
}

.slot-selector option {
    color: #e6e6e6;
    background: #262626;
}

.slot-selector:disabled,
.slot-selector[aria-disabled="true"] {
    cursor: default;
    color: rgba(255, 255, 255, 0.45);
    border-color: #3c3c3c;
}

/* a .field with a button attached on the right */
.field-row {
    display: flex;
}

.field-row > .field {
    flex: 1 1 auto;
    border-right: none;
}

/* inline code / ids */
.code {
    font-family: Consolas, "Courier New", monospace;
    padding: 0.05em 0.35em;
    background: #2e2e2e;
}

.restart-note {
    margin: 0;
    color: rgba(255, 255, 255, 0.5);
}

/* dialogs: <h1 class="dialog-title"><i class="dialog-icon .."/>Title</h1> */
.dialog-title {
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-size: 1.6em;
    font-weight: 400;
    margin: 0 0 0.9em;
}

.dialog-icon {
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.55);
}

.dialog-icon.warn {
    color: #e69569;
}

.dialog-icon.danger {
    color: #e06c6c;
}

.dialog-text {
    margin: 0 0 0.4em;
    line-height: 1.45;
}

.dialog-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
}

/* labeled form controls */
.form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
}

.form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.form-field {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.form-label {
    margin-bottom: 6px;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.5);
}

.form-label .optional {
    font-size: inherit;
    text-transform: none;
    letter-spacing: 0;
    color: rgba(255, 255, 255, 0.35);
}

.form-error {
    margin-top: 5px;
    font-size: 0.8em;
    color: tomato;
}

.field.invalid {
    border-color: tomato;
}

/* pick-one option cards */
.choice-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.choice {
    display: flex;
    gap: 0.6em;
    padding: 0.6em 0.75em;
    background: #262626;
    border: 1px solid #3c3c3c;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
}

.choice:hover {
    border-color: #6a6a6a;
}

.choice.selected {
    border-color: #9a9a9a;
    background: #2f2f2f;
}

.choice > input {
    display: none;
}

.choice > i {
    margin-top: 0.15em;
    width: 1.1em;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
}

.choice.selected > i {
    color: rgba(255, 255, 255, 0.9);
}

.choice-title {
    display: block;
}

.choice-desc {
    display: block;
    margin-top: 2px;
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.45);
}
</style>