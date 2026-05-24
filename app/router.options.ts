import type { RouterConfig } from "@nuxt/schema";

// 自定义 scrollBehavior：当导航回首页且存在状态缓存时，
// 恢复到缓存的滚动位置而非默认的顶部。
// 其余场景保持 Nuxt 默认行为：后退/前进用浏览器保存的位置，前进导航滚到顶部。
export default <RouterConfig>{
  scrollBehavior(to, _from, savedPosition) {
    // 后退/前进：使用浏览器保存的位置
    if (savedPosition) return savedPosition;

    // 同路径仅 query 变化（如弹窗开关）：保持当前滚动位置
    if (to.path === _from.path) return false;

    // 前进导航到首页：消费缓存中的 scrollY
    if (to.path === "/") {
      const y = useHomeStateCache().consumeScrollY();
      if (y > 0) return { top: y };
    }

    return { top: 0, left: 0 };
  },
};
