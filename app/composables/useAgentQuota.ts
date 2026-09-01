import type { AgentQuota } from "~/types/entities";

interface QuotaResponse {
  data: AgentQuota;
}

/**
 * 敲敲当日额度（GET /api/agent/quota，需登录）。
 *
 * 用量存在 Redis 的按「配额日」分桶计数器里（日切是**本地 04:00**，不是零点），
 * 所以每次 AI 回复定稿后都该 refresh 一次（token 是事后扣减的）。
 *
 * 用 useState 缓存，敲敲弹窗多处引用共享同一份状态。
 */
export function useAgentQuota() {
  const { $api } = useNuxtApp();
  const quota = useState<AgentQuota | null>("agent-quota", () => null);
  const loading = ref(false);

  const refresh = async () => {
    if (loading.value) return;
    loading.value = true;
    try {
      const res = await $api<QuotaResponse>("/api/agent/quota");
      quota.value = res?.data ?? null;
    } catch {
      // 静默失败：额度条是辅助信息，读不到就不显示，不该打断聊天
      quota.value = null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 额度条口径：只有 token 一条 —— 每人每天的 token 额度。
   *
   * 后端记的是「真实 token × 模型倍率」，所以贵模型掉得更快；1 倍模型下
   * 这个数就等于真实 token。全站还有一条预算，但那不是用户能左右的事，
   * 也不该暴露给用户；真被全站预算拦下时会走发送失败提示，不体现在这条进度上。
   */
  const usage = computed(() => {
    const q = quota.value;
    if (!q || !q.available) return null;
    const { used, limit } = q.tokens;
    const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return {
      percent,
      /** 是否已经打满（后端会拒绝下一条） */
      exhausted: limit > 0 && used >= limit,
      tokensUsed: used,
      tokensLimit: limit,
      resetAt: q.resetAt,
      /** 没配上限（<= 0）时不必显示额度条 */
      unlimited: limit <= 0,
    };
  });

  return { quota: computed(() => quota.value), usage, loading: computed(() => loading.value), refresh };
}
