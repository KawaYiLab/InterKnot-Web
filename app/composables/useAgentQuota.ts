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
   * 额度条口径：后端按加权 token（真实 token × 该模型的倍率）扣额度，但只回百分比 ——
   * token 数与上限都不下发，前端不必跟着后台改上限而改口径。
   * 后台没配上限（unlimited）或读不到用量（available=false）时返回 null，额度条整体不渲染。
   */
  const usage = computed(() => {
    const q = quota.value;
    if (!q || !q.available || q.unlimited) return null;
    return {
      // Number() 兜底：percent 缺字段时 Math.round(undefined) 会是 NaN，
      // 一路渗到 `额度 NaN%` 和 `width: NaN%`
      percent: Math.min(100, Math.max(0, Math.round(Number(q.percent) || 0))),
      /** 已打满：后端会拒绝下一条 */
      exhausted: q.exhausted === true,
      // 缺字段时给空串而不是 undefined：DmQuotaBar 的 resetAt 是必填 string，
      // new Date("") 是 Invalid Date，那边已经会把「04:00 重置」整段省掉
      resetAt: q.resetAt || "",
    };
  });

  return { quota: computed(() => quota.value), usage, loading: computed(() => loading.value), refresh };
}
