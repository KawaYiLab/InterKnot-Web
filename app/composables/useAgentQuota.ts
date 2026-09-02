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
   * 额度条口径：后端按成本（真实 token × 模型单价）扣额度，但只回百分比 ——
   * 金额和 token 都不下发，前端也就没法反推每个模型的采购价。
   * 后台没配上限（unlimited）或读不到用量（available=false）时返回 null，额度条整体不渲染。
   */
  const usage = computed(() => {
    const q = quota.value;
    if (!q || !q.available || q.unlimited) return null;
    return {
      percent: Math.min(100, Math.max(0, Math.round(q.percent))),
      /** 已打满：后端会拒绝下一条 */
      exhausted: q.exhausted,
      resetAt: q.resetAt,
    };
  });

  return { quota: computed(() => quota.value), usage, loading: computed(() => loading.value), refresh };
}
