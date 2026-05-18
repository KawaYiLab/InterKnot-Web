/**
 * useBodyScrollLock —— 全局 body 滚动锁的引用计数管理。
 *
 * 背景：多个 overlay（敲敲弹窗、帖子弹窗、登录弹窗 …）都要在打开时锁住
 * 页面滚动。如果各自直接写 `document.body.style.overflow`，一个弹窗的关闭
 * 会无脑把样式重置成 ""，把仍在显示的另一个弹窗的锁也一起去掉。
 *
 * 解决：所有 overlay 通过这里 acquire/release，用 Set 追踪当前持有者。
 *   - 第一个 acquire：保存 body.style.overflow 原值，设为 "hidden"
 *   - 中间增减 acquire 不动样式
 *   - 最后一个 release：恢复保存的原值
 *
 * 不参与 page-level 滚动锁（如 profile 页面的 MediaQuery 锁），那里是页面
 * 自身决定，不属于 overlay 栈。
 */

// 模块级单例：所有调用者共享同一份计数
const holders = new Set<symbol>();
let prevOverflow = "";

export function useBodyScrollLock() {
  /** 调用者持有一个 token；release 时必须传同一个 token，避免误释放别人的锁 */
  const acquire = (token: symbol): void => {
    if (!import.meta.client) return;
    if (holders.size === 0) {
      // 第一个 holder 进场：保存当前 body.overflow 的"原值"
      // 注意：如果页面（如 profile）此时已设了 "hidden"，原值就是 "hidden"，
      // 我们释放时还原成 "hidden" 也合理（页面层的锁继续生效）。
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    holders.add(token);
  };

  const release = (token: symbol): void => {
    if (!import.meta.client) return;
    if (!holders.has(token)) return;
    holders.delete(token);
    if (holders.size === 0) {
      document.body.style.overflow = prevOverflow;
    }
  };

  return { acquire, release };
}
