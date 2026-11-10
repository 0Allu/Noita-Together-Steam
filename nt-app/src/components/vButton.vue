<template>
    <button class="btn" @click="clickM" :class="cSize">
        <slot name="icon"></slot>
        <slot></slot>
    </button>
</template>

<script>
export default {
    name: "vButton",
    props: {
        size: {
            type: String,
            required: false
        }
    },
    computed: {
        cSize() {
            return this.size || "btn-normal"
        }
    },
    methods: {
        clickM(e) {
            this.$emit("click", e)
        }
    }
};
</script>

<style>
.btn-normal {
    font-size: 1.2em;
    padding: 0.625em 1em;
}

.btn-big {
    font-size: 1.6em;
    padding: 0.625em 1em;
}

.btn-small {
    font-size: 1em;
    padding: 0.325em 0.625em;
}

.btn {
    cursor: pointer;
    background-color: #696969;
    border: none;
    text-align: center;
    text-decoration: none;
    transition-duration: 0.3s;
}

.btn:hover {
    background-color: #808080;
    border: none;
}

.btn:focus {
    outline: none;
}

.btn:active {
    transform: scale(0.9);
}

/* the main action on a screen */
.btn-primary {
    background-color: #3f7a3a;
}

.btn-primary:hover {
    background-color: #4c9146;
}

/* leave / delete */
.btn-danger {
    background-color: #8a3232;
}

.btn-danger:hover {
    background-color: #a33c3c;
}

/* same height as a .field input, for buttons attached to one */
.btn-field {
    font-size: 1em;
    padding: 0 0.9em;
    height: 34px;
}

.btn:disabled,
.btn:disabled:hover {
    cursor: not-allowed;
    background-color: #4a4a4a;
    opacity: 0.55;
    transform: none;
}
</style>