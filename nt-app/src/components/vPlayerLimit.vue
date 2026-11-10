<template>
    <div class="player-limit">
        <button type="button" class="btn btn-field" :disabled="value <= min" @click="step(-1)" title="One less">
            <i class="fas fa-minus"></i>
        </button>
        <label class="field" :class="{ invalid: !!error }">
            <i class="fas fa-user-friends"></i>
            <input
                :id="inputId"
                type="number"
                :min="min"
                :max="max"
                step="1"
                :value="value"
                @input="onInput"
                @blur="onBlur"
            />
        </label>
        <button type="button" class="btn btn-field" :disabled="value >= max" @click="step(1)" title="One more">
            <i class="fas fa-plus"></i>
        </button>
    </div>
</template>

<script>
// matches MAX_USERS_LIMIT in steam/hostRoom.js
export const PLAYER_LIMIT_MAX = 120

/** Whole-number stepper for a room's player limit. v-model gives a number, or NaN while the box is empty. */
export default {
    name: "vPlayerLimit",
    props: {
        value: { type: Number, required: true },
        min: { type: Number, default: 1 },
        max: { type: Number, default: PLAYER_LIMIT_MAX },
        inputId: { type: String, required: false },
    },
    computed: {
        error() {
            return playerLimitError(this.value, this.min, this.max)
        },
    },
    methods: {
        clamp(n) {
            return Math.min(this.max, Math.max(this.min, n))
        },
        step(by) {
            const n = Number.isFinite(this.value) ? Math.round(this.value) : this.min
            this.$emit("input", this.clamp(n + by))
        },
        onInput(e) {
            this.$emit("input", e.target.value === "" ? NaN : Number(e.target.value))
        },
        onBlur(e) {
            // tidy up 7.5 or 500 once the player leaves the box
            if (Number.isFinite(this.value)) {
                const n = this.clamp(Math.round(this.value))
                if (n !== this.value) this.$emit("input", n)
                e.target.value = n
            }
        },
    },
}

export function playerLimitError(value, min = 1, max = PLAYER_LIMIT_MAX) {
    if (!Number.isFinite(value)) return "Enter a number of players."
    if (!Number.isInteger(value)) return "Use a whole number."
    if (value < min || value > max) return `Pick between ${min} and ${max}.`
    return ""
}
</script>

<style>
.player-limit {
    display: flex;
    gap: 6px;
}

.player-limit .field {
    flex: 1;
    min-width: 0;
}

.player-limit input {
    text-align: center;
    -moz-appearance: textfield;
}

.player-limit input::-webkit-outer-spin-button,
.player-limit input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.player-limit .btn-field {
    padding: 0 0.75em;
}
</style>
