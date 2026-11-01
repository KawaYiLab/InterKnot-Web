<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/24/outline";

/**
 * 移植自 Inspira UI「Placeholders And Vanish Input」的轮播占位：
 * 输入框为空时，占位提示每隔几秒从下往上换一条。改写为 scoped CSS，去掉了提交时的粒子消散。
 */
const props = withDefaults(
  defineProps<{
    placeholders?: string[];
    interval?: number;
  }>(),
  {
    placeholders: () => ["搜索..."],
    interval: 3000,
  },
);

const model = defineModel<string>({ default: "" });
const emit = defineEmits<{
  submit: [value: string];
  focus: [];
  blur: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const current = ref(0);
let timer: number | null = null;

const start = () => {
  stop();
  if (props.placeholders.length < 2) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = window.setInterval(() => {
    current.value = (current.value + 1) % props.placeholders.length;
  }, props.interval);
};

const stop = () => {
  if (timer != null) window.clearInterval(timer);
  timer = null;
};

const onVisibility = () => {
  if (document.visibilityState === "visible") start();
  else stop();
};

onMounted(() => {
  start();
  document.addEventListener("visibilitychange", onVisibility);
});

onBeforeUnmount(() => {
  stop();
  document.removeEventListener("visibilitychange", onVisibility);
});

const submit = () => emit("submit", model.value);

const clear = () => {
  model.value = "";
  inputRef.value?.focus();
};

defineExpose({
  focus: () => inputRef.value?.focus(),
  blur: () => inputRef.value?.blur(),
});
</script>

<template>
  <form class="ik-pi" :class="{ 'has-value': !!model }" role="search" @submit.prevent="submit">
    <MagnifyingGlassIcon class="ik-pi__icon" aria-hidden="true" />
    <input
      ref="inputRef"
      v-model="model"
      class="ik-pi__input"
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      :aria-label="placeholders[0]"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
    <div class="ik-pi__placeholder" aria-hidden="true">
      <Transition name="ik-pi-swap" mode="out-in">
        <span v-if="!model" :key="current" class="ik-pi__placeholder-text">{{ placeholders[current] }}</span>
      </Transition>
    </div>
    <button v-if="model" type="button" class="ik-pi__clear" aria-label="清空" @click="clear">
      <XMarkIcon aria-hidden="true" />
    </button>
  </form>
</template>

<style scoped>
.ik-pi {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 56px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: #141414;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.ik-pi:hover {
  border-color: rgba(255, 255, 255, 0.18);
}

.ik-pi:focus-within {
  border-color: var(--ik-primary, #bfff09);
  background: #171717;
  box-shadow: 0 0 0 4px rgba(191, 255, 9, 0.12), 0 10px 30px rgba(0, 0, 0, 0.35);
}

.ik-pi__icon {
  position: absolute;
  left: 22px;
  width: 20px;
  height: 20px;
  color: rgba(255, 255, 255, 0.45);
  stroke-width: 2.2;
  pointer-events: none;
  transition: color 0.2s ease;
}

.ik-pi:focus-within .ik-pi__icon {
  color: var(--ik-primary, #bfff09);
}

.ik-pi__input {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 0 52px 0 54px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 16px;
  outline: none;
  appearance: none;
}

.ik-pi__input::-webkit-search-cancel-button {
  display: none;
}

.ik-pi__placeholder {
  position: absolute;
  inset: 0 52px 0 54px;
  display: flex;
  align-items: center;
  overflow: hidden;
  pointer-events: none;
}

.ik-pi__placeholder-text {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.38);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-pi-swap-enter-active,
.ik-pi-swap-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.ik-pi-swap-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.ik-pi-swap-leave-to {
  opacity: 0;
  transform: translateY(-14px);
}

.ik-pi__clear {
  position: absolute;
  right: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.ik-pi__clear:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.ik-pi__clear svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.2;
}

@media (max-width: 768px) {
  .ik-pi {
    height: 48px;
  }

  .ik-pi__icon {
    left: 18px;
    width: 18px;
    height: 18px;
  }

  .ik-pi__input,
  .ik-pi__placeholder-text {
    font-size: 15px;
  }

  .ik-pi__input {
    padding: 0 48px 0 46px;
  }

  .ik-pi__placeholder {
    inset: 0 48px 0 46px;
  }

  .ik-pi__clear {
    right: 8px;
    width: 32px;
    height: 32px;
  }
}
</style>
