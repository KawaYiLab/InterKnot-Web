/**
 * usePendingPost — 发布委托后乐观插入首页瀑布流
 *
 * 用户在 /create 页发布成功后，把刚发布的 Post 对象塞进此模块级响应式队列，
 * 同时 router.replace("/")。首页 index.vue 在挂载/缓存恢复阶段消费这个队列，
 * 把委托 unshift 到 list 头部。
 *
 * 设计要点：
 * - 模块级 shallowRef：跨组件、跨路由共享，作为发布委托 → 首页的单向消息总线。
 *   同 useHomeStateCache 的模块级 let 模式，仅 client 端写入；SSR 阶段
 *   push 永远不会被调用，drain 在空队列上是 no-op，因此跨请求共享安全。
 * - 响应式：首页可 watch 队列，即便 push 发生在跳转之后到 onMounted 之前，
 *   或晚于 onMounted（fire-and-forget 的 getPost 还在飞），watch 都能消费到。
 * - FIFO drain：连续多次发布委托按发布顺序排列在列表顶部。
 */
import { shallowRef } from "vue";
import type { Post } from "~/types/entities";

const _pending = shallowRef<Post[]>([]);

export function usePendingPost() {
  function push(post: Post) {
    // 替换引用而非 mutate，确保 shallowRef 的 watch 能触发
    _pending.value = [..._pending.value, post];
  }

  /** 取出全部待插入委托并清空队列；返回顺序为 push 顺序 */
  function drain(): Post[] {
    const cur = _pending.value;
    if (!cur.length) return [];
    _pending.value = [];
    return cur;
  }

  function peek(): readonly Post[] {
    return _pending.value;
  }

  function clear() {
    if (_pending.value.length) _pending.value = [];
  }

  return { push, drain, peek, clear, queue: _pending };
}
