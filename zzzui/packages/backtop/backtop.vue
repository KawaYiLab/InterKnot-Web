<template>
  <z-button
    v-show="isVisible"
    class="z-backtop"
    size="extra"
    circle
    icon="caret-top"
    :style="{
      right: `${right}px`,
      bottom: `${bottom}px`
    }"
    @click="handleBacktopClick"
  ></z-button>
</template>

<script setup>
import { ref, watch } from 'vue';

defineOptions({
  name: 'ZBacktop'
})

const props = defineProps({
  target: Object,
  visibleHeight: {
    type: Number,
    default: 200
  },
  right: {
    type: Number,
    default: 60
  },
  bottom: {
    type: Number,
    default: 40
  }
})

const isVisible = ref(false)

const handleTargetScroll = () => {
  if (!props.target) return
  if (props.target.scrollTop >= props.visibleHeight && !isVisible.value) {
    isVisible.value = true
  } else if (props.target.scrollTop < props.visibleHeight && isVisible.value) {
    isVisible.value = false
  }
}

watch(() => props.target, (target, _previous, onCleanup) => {
  if (!target) {
    isVisible.value = false
    return
  }
  // 页面滚动事件发到 window；普通滚动容器仍监听其自身。
  const eventTarget = target === document.documentElement || target === document.body
    ? window
    : target
  handleTargetScroll()
  eventTarget.addEventListener('scroll', handleTargetScroll, { passive: true })
  onCleanup(() => eventTarget.removeEventListener('scroll', handleTargetScroll))
}, { immediate: true })

const handleBacktopClick = () => {
  if (props.target) {
    props.target.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }
}

</script>

<style scoped lang="scss">
.z-backtop {
  position: fixed;
  right: 60px;
  bottom: 40px;
  z-index: 10;
}
</style>
