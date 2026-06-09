const COLOR_ANIMATIONS = new Set([
  'z_ani_background', 'z_ani_border_color', 'z_ani_color', 'z_ani_outline_color'
])
const SIZE_ANIMATIONS = new Set([
  'z_ani_size', 'z_ani_skew_size', 'z_ani_outline_size'
])

let rafId = null

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const animationSync = () => {
  let colorCurTime = null
  let sizeCurTime = null

  document.getAnimations()
    .sort((p, n) => (p.startTime ?? Infinity) - (n.startTime ?? Infinity))
    .forEach((item) => {
      if (COLOR_ANIMATIONS.has(item.animationName)) {
        colorCurTime === null ? (colorCurTime = item.currentTime) : (item.currentTime = colorCurTime)
      } else if (SIZE_ANIMATIONS.has(item.animationName)) {
        sizeCurTime === null ? (sizeCurTime = item.currentTime) : (item.currentTime = sizeCurTime)
      }
    })

  rafId = requestAnimationFrame(animationSync)
}

export const startAnimationSync = () => {
  if (typeof document === 'undefined') return
  if (prefersReducedMotion()) return
  if (rafId !== null) return
  rafId = requestAnimationFrame(animationSync)
}

export const stopAnimationSync = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}
