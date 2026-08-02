import type { AiRoleCard } from "~/types/entities";

interface CharactersResponse {
  data: AiRoleCard[];
}

const FALLBACK_QUESTIONS = [
  "介绍一下你自己",
  "最近论坛有什么热门委托？",
  "帮我推荐一篇值得看的帖子",
];

/**
 * 根据角色卡生成兜底推荐问题。
 * 后端返回了 suggestedQuestions 则优先使用；否则用角色名/ bio 生成通用问题。
 */
const buildQuestions = (character: AiRoleCard | null | undefined): string[] => {
  if (!character) return FALLBACK_QUESTIONS;
  if (Array.isArray(character.suggestedQuestions) && character.suggestedQuestions.length > 0) {
    return character.suggestedQuestions;
  }
  const name = character.displayName || "你";
  return [
    `介绍一下${name}自己`,
    `作为${name}，你怎么看最近的委托？`,
    `给我推荐一篇适合${name}介绍的帖子`,
  ];
};

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
    getQuestions: (character: AiRoleCard | null | undefined) => buildQuestions(character),
  };
}
