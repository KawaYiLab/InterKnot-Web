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

const isDocumentTarget = (target) =>
  target === document.documentElement || target === document.body

// 整页滚动时不在 scroll 事件里读 scrollTop：页面有改动没排版时，这一读会让浏览器
// 当场重新排版（首页边滚边出图时每次滚动都中）。改成在 visibleHeight 处放一个
// 1px 的标记，交给 IntersectionObserver 告诉我们它是否已滚出视口上方。
const observeDocument = (onCleanup) => {
  const marker = document.createElement('div')
  marker.setAttribute('aria-hidden', 'true')
  marker.style.cssText = `position:absolute;top:${props.visibleHeight}px;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden`
  document.body.appendChild(marker)
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry) return
    isVisible.value = !entry.isIntersecting && entry.boundingClientRect.top < 0
  })
  observer.observe(marker)
  onCleanup(() => {
    observer.disconnect()
    marker.remove()
  })
}

watch(() => props.target, (target, _previous, onCleanup) => {
  if (!target) {
    isVisible.value = false
    return
  }
  if (isDocumentTarget(target) && typeof IntersectionObserver !== 'undefined') {
    observeDocument(onCleanup)
    return
  }
  handleTargetScroll()
  target.addEventListener('scroll', handleTargetScroll, { passive: true })
  onCleanup(() => target.removeEventListener('scroll', handleTargetScroll))
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