/** 个人页弹窗由 query 驱动；首次打开留一条历史，菜单内部切换复用当前项。 */
export function useProfileModalRoute() {
  const router = useRouter();
  let closing: Promise<void> | null = null;

  function open(name: string) {
    const route = router.currentRoute.value;
    const target = { path: route.path, query: { ...route.query, modal: name }, hash: route.hash };
    if (route.query.modal) return router.replace(target);
    return router.push({ ...target, state: { profileModalBackground: route.fullPath } });
  }

  function close(): Promise<void> {
    if (closing) return closing;
    const route = router.currentRoute.value;
    if (!route.query.modal) return Promise.resolve();
    const { modal: _, ...query } = route.query;
    const target = { path: route.path, query, hash: route.hash };
    const background = router.resolve(target).fullPath;
    const state = router.options.history.state;

    // 只返回由本页打开弹窗时留下的背景；直达链接关闭后仍留在个人页。
    if (state.profileModalBackground === background && state.back === background) {
      closing = new Promise<void>((resolve) => {
        const remove = router.afterEach(() => {
          remove();
          closing = null;
          resolve();
        });
        router.back();
      });
    } else {
      closing = router.replace(target).then(() => {}).finally(() => { closing = null; });
    }
    return closing;
  }

  return { open, close };
}
