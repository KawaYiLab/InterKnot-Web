import { computed } from "vue";
import type { BenefitValues } from "~/utils/benefits";
import { BENEFIT_MAX_LEVEL, benefitsForLevel, clampBenefitLevel } from "~/utils/benefits";

interface BenefitsState {
  level: number;
  benefits: BenefitValues;
  nextLevel?: number;
  nextBenefits?: BenefitValues;
}

/**
 * 当前用户的等级权益。以服务端 /api/benefits/me 为准；
 * 接口未返回前按本地矩阵（依据 auth.user.level）兜底展示。
 * 服务端在写接口上做强校验，前端数值仅用于体验优化。
 */
export function useBenefits() {
  const api = useApi();
  const auth = useAuthStore();

  const serverState = useState<BenefitsState | null>("benefits-me", () => null);
  const loading = useState<boolean>("benefits-me-loading", () => false);
  // 记录拉取时的用户身份，登录/登出/切号后自动重新拉取
  const fetchedFor = useState<string | null>("benefits-me-user", () => null);

  const fallbackLevel = computed(() => {
    const user = auth.user as
      | { level?: number; isAdmin?: boolean; isAiAgent?: boolean }
      | null
      | undefined;
    if (!user) return 0;
    if (user.isAdmin === true || user.isAiAgent === true) return BENEFIT_MAX_LEVEL;
    return clampBenefitLevel(user.level);
  });

  const identity = computed(() => {
    const user = auth.user as { documentId?: string } | null | undefined;
    return user?.documentId ?? "guest";
  });

  const refresh = async () => {
    const forIdentity = identity.value;
    loading.value = true;
    fetchedFor.value = forIdentity;
    try {
      const data = await api.getMyBenefits();
      // 请求期间登出/切号则丢弃过期响应，由 watcher 重新拉取
      if (identity.value !== forIdentity) return;
      serverState.value = {
        level: data.level,
        benefits: data.benefits,
        ...(data.nextLevel != null && data.nextBenefits
          ? { nextLevel: data.nextLevel, nextBenefits: data.nextBenefits }
          : {}),
      };
    } catch {
      // 接口失败时保持本地矩阵兜底
    } finally {
      if (fetchedFor.value === forIdentity) {
        loading.value = false;
      }
    }
  };

  if (import.meta.client) {
    // 身份变化（登录/登出/切号）或同一用户等级变化（升级）时重新拉取
    watch(
      [identity, fallbackLevel] as const,
      ([id], prev) => {
        if (loading.value && fetchedFor.value === id) return;
        const identityChanged = prev == null || prev[0] !== id;
        if (identityChanged) {
          serverState.value = null;
        } else if (serverState.value && fetchedFor.value === id && serverState.value.level === fallbackLevel.value) {
          return;
        }
        // 身份变化时清空重拉；等级变化时保留旧值展示、后台刷新
        refresh();
      },
      { immediate: true },
    );
  }

  const level = computed(() => serverState.value?.level ?? fallbackLevel.value);
  const benefits = computed<BenefitValues>(
    () => serverState.value?.benefits ?? benefitsForLevel(fallbackLevel.value),
  );
  const nextLevel = computed(() => serverState.value?.nextLevel ?? null);
  const nextBenefits = computed(() => serverState.value?.nextBenefits ?? null);

  const articleMaxImages = computed(() => benefits.value.articleMaxImages);
  const commentMaxImages = computed(() => benefits.value.commentMaxImages);
  const articleMaxBody = computed(() => benefits.value.articleMaxBody);

  return {
    level,
    benefits,
    nextLevel,
    nextBenefits,
    articleMaxImages,
    commentMaxImages,
    articleMaxBody,
    refresh,
  };
}
