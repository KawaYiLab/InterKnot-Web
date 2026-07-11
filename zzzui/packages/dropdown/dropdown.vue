<template>
  <div
    :class="['z-dropdown', {
      [`z-dropdown--${size}`]: size,
      'is-visible': visible,
      'is-bold': zenless.isBold
    }]"
    @mousedown.stop
    @mouseenter="onHoverHandler"
    @mouseleave="onLeaveHandler"
    @click="onClickHandler"
  >
    <slot></slot>
    <div class="z-dropdown__content">
      <slot name="dropdown"></slot>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, onMounted, onBeforeUnmount } from 'vue'
import { useZenless } from 'zenless-ui/index'
import { zenlessSizes } from 'zenless-ui/constants'
import { dropdownTriggers, dropdownContextKey } from './constants'
import { registerDropdown, closeAllDropdownsExcept } from './manager'

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
  }
})
const visible = ref(false)
const emits = defineEmits(['command', 'trigger'])

const onHideMenu = () => {
  if (props.disabled) return
  if (!visible.value) return
  visible.value = false
  emits('trigger', visible.value)
  document.removeEventListener('mousedown', onHideMenu)
}

const onHoverHandler = () => {
  if (props.disabled) return
  if (props.trigger !== 'hover') return
  if (visible.value) return
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