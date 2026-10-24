const SYNC_ANIMATIONS = new Set([
  'z_ani_background', 'z_ani_border_color', 'z_ani_color', 'z_ani_outline_color',
  'z_ani_size', 'z_ani_skew_size', 'z_ani_outline_size'
])

// 同名动画时长相同，把 currentTime 对齐到文档时间轴即可同相位，无需找参照动画。
// 只在动画开始时对齐一次：之后各动画同速推进，自然保持同步。
// 不再每帧轮询 document.getAnimations()——它会强制样式重算，常驻 rAF 会占满主线程。
const alignAnimation = (animation) => {
  if (!SYNC_ANIMATIONS.has(animation.animationName)) return
  const now = document.timeline.currentTime
  if (now === null) return
  animation.currentTime = now
}

const pendingTargets = new Set()
let flushScheduled = false

const flush = () => {
  flushScheduled = false
  pendingTargets.forEach((target) => {
    // subtree 才能拿到 ::before / ::after 上的动画（事件 target 是宿主元素）
    if (target.isConnected) target.getAnimations({ subtree: true }).forEach(alignAnimation)
  })
  pendingTargets.clear()
}

const onAnimationStart = (e) => {
  if (!SYNC_ANIMATIONS.has(e.animationName)) return
  pendingTargets.add(e.target)
  if (flushScheduled) return
  flushScheduled = true
  requestAnimationFrame(flush)
}

let started = false

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const startAnimationSync = () => {
  if (typeof document === 'undefined') return
  if (prefersReducedMotion()) return
  if (started) return
  started = true
  document.addEventListener('animationstart', onAnimationStart, true)
  document.getAnimations().forEach(alignAnimation)
}

export const stopAnimationSync = () => {
  if (!started) return
  started = false
  document.removeEventListener('animationstart', onAnimationStart, true)
  pendingTargets.clear()
}
