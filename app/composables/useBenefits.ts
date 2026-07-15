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
    if (loading.value) return;
    loading.value = true;
    fetchedFor.value = identity.value;
    try {
      const data = await api.getMyBenefits();
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
      loading.value = false;
    }
  };

  if (import.meta.client) {
    watch(
      identity,
      () => {
        if (loading.value && fetchedFor.value === identity.value) return;
        if (serverState.value && fetchedFor.value === identity.value) return;
        serverState.value = null;
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
