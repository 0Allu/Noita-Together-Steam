<template>
    <div class="tooltip-wrapper">
        <slot name="content">
            <i class="far fa-question-circle" ref="icon"></i>
        </slot>
        <div class="tooltip" ref="tooltip">
            <slot></slot>
        </div>
    </div>
</template>

<script>
import { createPopper } from "@popperjs/core";
export default {
    data() {
        return {
            tooltip: null,
        };
    },
    mounted() {
        if (this.$refs.tooltip) {
            const content = this.$slots.content && this.$slots.content[0]
            const def = this.$refs.icon
            const elm = content && content.elm
            this.tooltip = createPopper(elm || def, this.$refs.tooltip, {
                placement: "top",
                // fixed: not cut off by scrolling dialogs; stays inside the window
                strategy: "fixed",
                modifiers: [
                    { name: "offset", options: { offset: [0, 15] } },
                    { name: "preventOverflow", options: { boundary: "viewport", padding: 8, altAxis: true, tether: false } },
                    { name: "flip", options: { boundary: "viewport", padding: 8, fallbackPlacements: ["bottom", "left", "right"] } },
                ],
            });
            // the size can change with the window; position again when it's shown
            this.$el.addEventListener("mouseenter", this.reposition)
        }
    },
    methods: {
        reposition() {
            if (this.tooltip) this.tooltip.update();
        },
    },
    beforeDestroy() {
        if (this.$el) this.$el.removeEventListener("mouseenter", this.reposition)
        if (this.tooltip) {
            this.tooltip.destroy();
            this.tooltip = null;
        }
    },
};
</script>

<style>
.tooltip-wrapper {
    display: inline;
}

.tooltip-wrapper .tooltip {
    visibility: hidden;
    background-color: #0e0e0e;
    color: rgba(255, 255, 255, 0.8);
    padding: 1em;
    border-radius: 3px;
    /* long texts wrap instead of running off the window */
    max-width: min(360px, calc(100vw - 16px));
    box-sizing: border-box;
    white-space: normal;
    overflow-wrap: break-word;
    text-transform: none;
    font-weight: normal;
    line-height: 1.4;
    z-index: 1000;
}

.tooltip-wrapper:hover .tooltip {
    visibility: visible;
    opacity: 1;
}
</style>