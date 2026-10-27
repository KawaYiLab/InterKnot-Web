<script setup lang="ts">
/**
 * 移植自 Inspira UI「Input」：鼠标移到输入框上时，边框上跟着指针亮起一圈光。
 * 外层是 2px 的光圈容器，`prefix` / `suffix` 插槽放在输入框两侧。
 */
import { computed, ref } from "vue";

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ color?: string; radius?: number }>(), {
  color: "var(--ik-primary)",
  radius: 80,
});
const model = defineModel<string>({ default: "" });

const containerRef = ref<HTMLDivElement | null>(null);
const mouse = ref({ x: 0, y: 0 });
const visible = ref(false);

const onMove = ({ clientX, clientY }: MouseEvent) => {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return;
  mouse.value = { x: clientX - rect.left, y: clientY - rect.top };
};

const glow = computed(() => ({ x: `${mouse.value.x}px`, y: `${mouse.value.y}px` }));
</script>

<template>
  <div
    ref="containerRef"
    class="ik-spotlight-input"
    :style="{
      backgroundImage: `radial-gradient(${visible ? radius : 0}px circle at ${glow.x} ${glow.y}, ${color}, transparent 80%)`,
    }"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
    @mousemove="onMove"
  >
    <div class="ik-spotlight-input__field">
      <slot name="prefix" />
      <input v-bind="$attrs" v-model="model" class="ik-spotlight-input__inner" />
      <slot name="suffix" />
    </div>
  </div>
</template>

<style scoped>
.ik-spotlight-input {
  padding: 1px;
  border-radius: 999px;
  background-color: #2a2a2a;
  transition: background 300ms ease;
}

.ik-spotlight-input__field {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 4px 0 12px;
  border-radius: inherit;
  background: #111;
}

.ik-spotlight-input__inner {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: #ededed;
  font: inherit;
  font-size: 13px;
}

.ik-spotlight-input__inner::placeholder {
  color: #666;
}

.ik-spotlight-input:focus-within {
  background-color: #555;
}
</style>
