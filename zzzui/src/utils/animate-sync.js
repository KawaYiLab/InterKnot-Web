const COLOR_ANIMATIONS = new Set([
  'z_ani_background', 'z_ani_border_color', 'z_ani_color', 'z_ani_outline_color'
])
const SIZE_ANIMATIONS = new Set([
  'z_ani_size', 'z_ani_skew_size', 'z_ani_outline_size'
])

let rafId = null

const animationSync = () => {
  let colorCurTime
  let sizeCurTime

  document.getAnimations()
    .sort((p, n) => (p.startTime ?? Infinity) - (n.startTime ?? Infinity))
    .forEach((item) => {
      if (COLOR_ANIMATIONS.has(item.animationName)) {
        colorCurTime ? (item.currentTime = colorCurTime) : (colorCurTime = item.currentTime)
      } else if (SIZE_ANIMATIONS.has(item.animationName)) {
        sizeCurTime ? (item.currentTime = sizeCurTime) : (sizeCurTime = item.currentTime)
      }
    })

  rafId = requestAnimationFrame(animationSync)
}

export const startAnimationSync = () => {
  if (typeof document === 'undefined') return
  if (rafId !== null) return
  rafId = requestAnimationFrame(animationSync)
}

export const stopAnimationSync = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}
