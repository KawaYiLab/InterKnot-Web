<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import InspiraShineBorder from "~/components/inspira/ShineBorder.vue";
import InspiraVanishCanvas from "~/components/inspira/VanishCanvas.vue";

/**
 * 移植自 Inspira UI「Placeholders And Vanish Input」，外观与敲敲输入框（DmComposer）一致：
 * 点阵底 + 粗描边 + 流光边框，右侧 zzzui 按钮；空输入时占位从下往上轮播，
 * 点清空时文字碎成粒子散掉。搜索提交不清空输入，所以提交时不播消散。
 */
const props = withDefaults(
  defineProps<{
    placeholders?: string[];
    ariaLabel?: string;
    interval?: number;
    submitLabel?: string;
  }>(),
  {
    placeholders: () => ["搜索..."],
    interval: 3000,
    submitLabel: "搜索",
  },
);

const model = defineModel<string>({ default: "" });
const emit = defineEmits<{
  submit: [value: string];
  focus: [];
  blur: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const vanishRef = ref<InstanceType<typeof InspiraVanishCanvas> | null>(null);
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
  if (inputRef.value) vanishRef.value?.play(inputRef.value);
  model.value = "";
  inputRef.value?.focus();
};

defineExpose({
  focus: () => inputRef.value?.focus(),
  blur: () => inputRef.value?.blur(),
});
</script>

<template>
  <form class="ik-pi" role="search" @submit.prevent="submit">
    <InspiraShineBorder class="ik-pi__shine" :border-width="3" />
    <MagnifyingGlassIcon class="ik-pi__icon" aria-hidden="true" />
    <div class="ik-pi__field">
      <input
        ref="inputRef"
        v-model="model"
        class="ik-pi__input"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        :aria-label="ariaLabel || placeholders[0]"
        @focus="emit('focus')"
        @blur="emit('blur')"
      />
      <Transition name="ik-pi-swap">
        <span v-if="!model" :key="current" class="ik-pi__placeholder" aria-hidden="true">{{ placeholders[current] }}</span>
      </Transition>
      <InspiraVanishCanvas ref="vanishRef" />
    </div>
    <button v-if="model" type="button" class="ik-pi__clear" aria-label="清空" @click="clear">
      <XMarkIcon aria-hidden="true" />
    </button>
    <z-button class="ik-pi__submit" native-type="submit">{{ submitLabel }}</z-button>
  </form>
</template>

<style scoped>
.ik-pi {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 4px 4px 18px;
  border: 3px solid #313131;
  border-radius: 999px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.ik-pi:focus-within {
  border-color: #fbfe00;
  box-shadow: 0 0 0 4px rgba(251, 254, 0, 0.12), 0 0 24px rgba(251, 254, 0, 0.12);
}

/* 流光叠在静态描边上；聚焦后描边已经是黄色，流光退场 */
.ik-pi__shine {
  transition: opacity 200ms ease;
}

.ik-pi:focus-within .ik-pi__shine {
  opacity: 0;
}

.ik-pi__icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  color: rgba(255, 255, 255, 0.4);
  stroke-width: 2.2;
  transition: color 160ms ease;
}

.ik-pi:focus-within .ik-pi__icon {
  color: #fbfe00;
}

.ik-pi__field {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}

.ik-pi__input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 11px 8px;
  border: 0;
  background: transparent;
  color: #fff;
  caret-color: #fbfe00;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  outline: none;
  appearance: none;
}

.ik-pi__input::-webkit-search-cancel-button {
  display: none;
}

.ik-pi__input::selection {
  background: #fbfe00;
  color: #000;
}

.ik-pi__placeholder {
  position: absolute;
  top: 11px;
  left: 8px;
  right: 8px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.32);
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.ik-pi-swap-enter-active,
.ik-pi-swap-leave-active {
  transition: opacity 300ms ease, transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ik-pi-swap-enter-from {
  opacity: 0;
  transform: translateY(60%);
}

.ik-pi-swap-leave-to {
  opacity: 0;
  transform: translateY(-60%);
}

.ik-pi__clear {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: color 140ms ease, background-color 140ms ease;
}

.ik-pi__clear:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.ik-pi__clear svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.2;
}

.ik-pi__submit {
  flex: 0 0 auto;
}

@media (max-width: 768px) {
  .ik-pi {
    padding-left: 14px;
  }

  .ik-pi__icon {
    width: 18px;
    height: 18px;
  }

  .ik-pi__input {
    height: 40px;
    padding: 9px 6px;
    font-size: 15px;
  }

  .ik-pi__placeholder {
    top: 9px;
    left: 6px;
    right: 6px;
    font-size: 15px;
  }

  .ik-pi__clear {
    width: 32px;
    height: 32px;
  }
}
</style>
