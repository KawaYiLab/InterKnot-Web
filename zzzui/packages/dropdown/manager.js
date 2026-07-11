const closeFns = new Set()

export function registerDropdown(closeFn) {
  closeFns.add(closeFn)
  return () => {
    closeFns.delete(closeFn)
  }
}

export function closeAllDropdownsExcept(exceptCloseFn) {
  closeFns.forEach((fn) => {
    if (fn !== exceptCloseFn) {
      try {
        fn()
      } catch (e) {
        // ignore
      }
    }
  })
}

function isContainingBlock(el) {
  if (!el) return false
  const style = window.getComputedStyle(el)
  return (
    style.position !== 'static' ||
    style.transform !== 'none' ||
    style.filter !== 'none' ||
    style.perspective !== 'none' ||
    style.clipPath !== 'none' ||
    style.contain.includes('paint') ||
    style.contain.includes('layout') ||
    style.containerType !== 'normal'
  )
}

export function getClippingAncestor(el) {
  let ancestor = el?.parentElement
  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor)
    if (
      style.overflowY !== 'visible' &&
      isContainingBlock(ancestor)
    ) {
      return ancestor
    }
    ancestor = ancestor.parentElement
  }
  return null
}
