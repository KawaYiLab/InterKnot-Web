import type { AiRoleCard } from "~/types/entities";

interface CharacterDto {
  slug: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  sortOrder: number;
  suggestedQuestions: string[];
  defaultModelKey?: string | null;
  allowedModelKeys?: string[] | null;
  user: { id: string; username: string; avatarUrl?: string | null };
}

function toRoleCard(c: CharacterDto): AiRoleCard {
  return {
    slug: c.slug,
    displayName: c.displayName,
    bio: c.bio ?? null,
    avatar: c.avatarUrl ?? c.user?.avatarUrl ?? null,
    sortOrder: c.sortOrder,
    suggestedQuestions: c.suggestedQuestions ?? null,
    boundUser: c.user
      ? {
          id: c.user.id,
          login: c.user.username,
          isAiAgent: true,
          authorDocumentId: c.user.id,
          name: c.user.username,
          avatar: c.user.avatarUrl ?? null,
        }
      : null,
    defaultModelKey: c.defaultModelKey ?? null,
    // 空数组 = 不限制
    allowedModelKeys: c.allowedModelKeys?.length ? c.allowedModelKeys : null,
  };
}

/**
 * 可聊天的 AI 角色列表（敲敲「通话」Tab）。
 */
export function useAiCharacters() {
  const { $api } = useNuxtApp();
  const characters = useState<AiRoleCard[]>("ai-characters", () => []);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const refresh = async () => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await $api<{ items: CharacterDto[] }>("/v1/ai/characters");
      characters.value = Array.isArray(res?.items) ? res.items.map(toRoleCard) : [];
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "加载 AI 角色失败";
      characters.value = [];
    } finally {
      loading.value = false;
    }
  };

  return {
    characters: computed(() => characters.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refresh,
  };
}
