import type { AiModel } from "~/types/entities";

interface ModelsResponse {
  data: AiModel[];
}

/**
 * 敲敲可选模型清单（GET /api/agent/models，公开只读）。
 *
 * 清单变动极少（后台手工维护），所以用 useState 全局缓存一次，
 * 已加载过就不再请求；角色卡白名单过滤在使用侧做（见 KnockKnockModal
 * 的 activeModelOptions），因为那里还要参考当前会话是不是 AI 会话。
 */
export function useAiModels() {
  const { $api } = useNuxtApp();
  const models = useState<AiModel[]>("ai-models", () => []);
  const loaded = useState<boolean>("ai-models-loaded", () => false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const refresh = async (force = false) => {
    if (loading.value) return;
    if (loaded.value && !force) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await $api<ModelsResponse>("/api/agent/models");
      models.value = Array.isArray(res?.data) ? res.data : [];
      loaded.value = true;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "加载模型列表失败";
      models.value = [];
    } finally {
      loading.value = false;
    }
  };

  return {
    models: computed(() => models.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refresh,
  };
}
