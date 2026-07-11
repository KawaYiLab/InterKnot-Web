<template>
  <div
    ref="rootRef"
    :class="['z-dropdown', {
      [`z-dropdown--${size}`]: size,
      'is-visible': visible,
      'is-bold': zenless.isBold,
      [`z-dropdown--direction-${currentDirection}`]: currentDirection
    }]"
    @mousedown.stop
    @mouseenter="onHoverHandler"
    @mouseleave="onLeaveHandler"
    @click="onClickHandler"
  >
    <slot></slot>
    <div ref="contentRef" class="z-dropdown__content">
      <slot name="dropdown"></slot>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, onMounted, onBeforeUnmount } from 'vue'
import { useZenless } from 'zenless-ui/index'
import { zenlessSizes } from 'zenless-ui/constants'
import { dropdownTriggers, dropdownContextKey } from './constants'
import { registerDropdown, closeAllDropdownsExcept, getClippingAncestor } from './manager'

defineOptions({
  name: 'ZDropdown'
})

const zenless = useZenless()
const props = defineProps({
  trigger: {
    type: String,
    default: 'hover',
    validator: (v) => dropdownTriggers.includes(v)
  },
  disabled: Boolean,
  size: {
    type: String,
    validator: (v) => zenlessSizes.includes(v)
  },
  hideOnCommand: {
    type: Boolean,
    default: true
  },
  direction: {
    type: String,
    default: 'auto',
    validator: (v) => ['auto', 'up', 'down'].includes(v)
  }
})
const visible = ref(false)
const currentDirection = ref('down')
const rootRef = ref(null)
const contentRef = ref(null)
const emits = defineEmits(['command', 'trigger'])

const sizeHeights = {
  extra: 52,
  large: 46,
  default: 40,
  small: 34,
  mini: 30
}

const getMenuHeight = () => {
  const content = contentRef.value
  if (!content) return 0
  const scrollHeight = content.scrollHeight
  if (scrollHeight) return scrollHeight
  const items = content.querySelectorAll('.z-dropdown-item')
  const itemHeight = sizeHeights[props.size] || sizeHeights.default
  const count = items.length || 1
  return itemHeight * count + 4 * (count - 1) + 8
}

const getSpaceAbove = () => {
  const root = rootRef.value
  if (!root) return Number.POSITIVE_INFINITY
  const rootRect = root.getBoundingClientRect()
  const ancestor = getClippingAncestor(root)
  const ancestorTop = ancestor ? ancestor.getBoundingClientRect().top : 0
  return rootRect.top - ancestorTop
}

const onHideMenu = () => {
  if (props.disabled) return
  if (!visible.value) return
  visible.value = false
  emits('trigger', visible.value)
  document.removeEventListener('mousedown', onHideMenu)
}

const resolveDirection = () => {
  if (props.direction !== 'auto') {
    currentDirection.value = props.direction
    return
  }
  const spaceAbove = getSpaceAbove()
  const menuHeight = getMenuHeight()
  currentDirection.value = spaceAbove < menuHeight + 8 ? 'down' : 'up'
}

const onHoverHandler = () => {
  if (props.disabled) return
  if (props.trigger !== 'hover') return
  if (visible.value) return
  resolveDirection()
  closeAllDropdownsExcept(onHideMenu)
  visible.value = true
  emits('trigger', visible.value)
}
const onLeaveHandler = () => {
  if (props.disabled) return
  if (props.trigger !== 'hover') return
  onHideMenu()
}
const onClickHandler = () => {
  if (props.disabled) return
  if (props.trigger !== 'click') return
  if (visible.value) {
    onHideMenu()
    return
  }
  resolveDirection()
  closeAllDropdownsExcept(onHideMenu)
  visible.value = true
  emits('trigger', visible.value)
  document.addEventListener('mousedown', onHideMenu)
}
const handleItemClick = (command) => {
  if (props.disabled) return
  if (props.hideOnCommand) {
    onHideMenu()
  }
  emits('command', command)
}

let unregisterDropdown = null
onMounted(() => {
  unregisterDropdown = registerDropdown(onHideMenu)
})
onBeforeUnmount(() => {
  if (unregisterDropdown) unregisterDropdown()
  document.removeEventListener('mousedown', onHideMenu)
})

provide(dropdownContextKey, {
  handleItemClick
})
</script>

<style scoped>
@import './dropdown.scss';
</style>