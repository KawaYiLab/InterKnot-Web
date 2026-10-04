<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { computed } from "vue";
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<DialogContentProps & {
    side?: "top" | "right" | "bottom" | "left";
    class?: HTMLAttributes["class"];
  }>(),
  { side: "right" },
);
const emits = defineEmits<DialogContentEmits>();

const delegated = computed(() => {
  const { class: _class, side: _side, ...rest } = props;
  return rest;
});
const forwarded = useForwardPropsEmits(delegated, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay data-slot="sheet-overlay" class="ik-sheet-overlay" />
    <DialogContent
      data-slot="sheet-content"
      :class="['ik-sheet-content', `ik-sheet-content--${props.side}`, props.class]"
      v-bind="{ ...forwarded, ...$attrs }"
    >
      <slot />
      <DialogClose class="ik-sheet-close" aria-label="关闭">
        <img src="/images/close-btn.webp" alt="" class="ik-sheet-close__img" draggable="false" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>

<style scoped>
/* 层级低于 ConfirmDialog（9100），让「放弃修改」确认框能盖在面板之上。 */
.ik-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.ik-sheet-overlay[data-state="open"] { animation: ik-sheet-fade-in 200ms ease-out; }
.ik-sheet-overlay[data-state="closed"] { animation: ik-sheet-fade-out 160ms ease-in; }

.ik-sheet-content {
  position: fixed;
  z-index: 9001;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #121212;
  color: #fff;
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.7);
  outline: none;
}

.ik-sheet-content--right,
.ik-sheet-content--left {
  top: 0;
  bottom: 0;
  width: min(420px, 92vw);
}
.ik-sheet-content--right {
  right: 0;
  border-left: 2px solid #2d2c2d;
  border-radius: 24px 0 0 24px;
}
.ik-sheet-content--left {
  left: 0;
  border-right: 2px solid #2d2c2d;
  border-radius: 0 24px 24px 0;
}
.ik-sheet-content--top,
.ik-sheet-content--bottom {
  left: 0;
  right: 0;
  max-height: 88vh;
}
.ik-sheet-content--top {
  top: 0;
  border-bottom: 2px solid #2d2c2d;
  border-radius: 0 0 24px 24px;
}
.ik-sheet-content--bottom {
  bottom: 0;
  border-top: 2px solid #2d2c2d;
  border-radius: 24px 24px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.ik-sheet-content--right[data-state="open"] { animation: ik-sheet-in-right 280ms cubic-bezier(0.22, 1, 0.36, 1); }
.ik-sheet-content--right[data-state="closed"] { animation: ik-sheet-out-right 200ms ease-in; }
.ik-sheet-content--left[data-state="open"] { animation: ik-sheet-in-left 280ms cubic-bezier(0.22, 1, 0.36, 1); }
.ik-sheet-content--left[data-state="closed"] { animation: ik-sheet-out-left 200ms ease-in; }
.ik-sheet-content--bottom[data-state="open"] { animation: ik-sheet-in-bottom 280ms cubic-bezier(0.22, 1, 0.36, 1); }
.ik-sheet-content--bottom[data-state="closed"] { animation: ik-sheet-out-bottom 200ms ease-in; }
.ik-sheet-content--top[data-state="open"] { animation: ik-sheet-in-top 280ms cubic-bezier(0.22, 1, 0.36, 1); }
.ik-sheet-content--top[data-state="closed"] { animation: ik-sheet-out-top 200ms ease-in; }

.ik-sheet-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}
.ik-sheet-close:hover { opacity: 0.85; transform: scale(1.08); }
.ik-sheet-close:active { transform: scale(0.95); }
.ik-sheet-close__img {
  display: block;
  height: 30px;
  width: auto;
  pointer-events: none;
  user-select: none;
}

@keyframes ik-sheet-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ik-sheet-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ik-sheet-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes ik-sheet-out-right { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes ik-sheet-in-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes ik-sheet-out-left { from { transform: translateX(0); } to { transform: translateX(-100%); } }
@keyframes ik-sheet-in-bottom { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes ik-sheet-out-bottom { from { transform: translateY(0); } to { transform: translateY(100%); } }
@keyframes ik-sheet-in-top { from { transform: translateY(-100%); } to { transform: translateY(0); } }
@keyframes ik-sheet-out-top { from { transform: translateY(0); } to { transform: translateY(-100%); } }

@media (prefers-reduced-motion: reduce) {
  .ik-sheet-overlay,
  .ik-sheet-content {
    animation: none !important;
  }
}
</style>
