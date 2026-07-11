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
