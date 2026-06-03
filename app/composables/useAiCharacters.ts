import type { AiRoleCard } from "~/types/entities";

interface CharactersResponse {
  data: AiRoleCard[];
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
      const res = await $api<CharactersResponse>("/api/agent/characters");
      characters.value = Array.isArray(res?.data) ? res.data : [];
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
