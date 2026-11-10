<template>
    <vModal size="small">
        <h1 slot="header" class="dialog-title">
            <i class="fas fa-user-friends dialog-icon"></i>
            Player limit
        </h1>
        <form slot="body" class="form" @submit.prevent="save">
            <div class="form-field">
                <label class="form-label" for="limit-input">Max players</label>
                <vPlayerLimit input-id="limit-input" v-model="limit" :min="1" />
                <span v-if="error" class="form-error">{{ error }}</span>
                <p v-else class="field-hint">
                    {{ playerCount }} {{ playerCount === 1 ? "player is" : "players are" }} in the room.
                    <template v-if="limit < playerCount">Nobody gets kicked, but no one new can join until it drops below {{ limit }}.</template>
                </p>
            </div>
            <button type="submit" hidden></button>
        </form>
        <div slot="footer" class="dialog-actions">
            <vButton @click="$emit('close')">Cancel</vButton>
            <vButton class="btn-primary" @click="save" :disabled="!!error">Save</vButton>
        </div>
    </vModal>
</template>

<script>
import vModal from "./vModal.vue"
import vButton from "./vButton.vue"
import vPlayerLimit, { playerLimitError } from "./vPlayerLimit.vue"

export default {
    name: "vPlayerLimitDialog",
    components: { vModal, vButton, vPlayerLimit },
    props: {
        current: { type: Number, required: true },
        playerCount: { type: Number, required: true },
    },
    data() {
        return { limit: this.current }
    },
    mounted() {
        const input = this.$el.querySelector("#limit-input")
        if (input) {
            input.focus()
            input.select()
        }
    },
    computed: {
        error() {
            return playerLimitError(this.limit)
        },
    },
    methods: {
        save() {
            if (this.error) return
            this.$emit("save", this.limit)
        },
    },
}
</script>
