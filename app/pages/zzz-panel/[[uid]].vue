<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { ZzzPanelAvatar, ZzzPanelsResult } from "~/types/entities";
import { resolveErrorMessage, isNotFoundError } from "~/utils/api-error";

const route = useRoute();
const router = useRouter();
const api = useApi();
const message = useMessage();
const auth = useAuthStore();
const pageDataLoading = usePageDataLoading();

const rawUid = computed(() => (route.params.uid as string | undefined) || "");
const isSelf = computed(() => !rawUid.value);

const loading = ref(false);
const loadError = ref(false);
const panels = ref<ZzzPanelsResult | null>(null);
const selectedIndex = ref(0);

const selectedAvatar = computed<ZzzPanelAvatar | null>(() =>
  panels.value?.avatars[selectedIndex.value] ?? null,
);

const loadPanels = async () => {
  loading.value = true;
  loadError.value = false;
  pageDataLoading.claim();
  try {
    const data = isSelf.value
      ? await api.getMyZzzPanels()
      : await api.getZzzPanels(rawUid.value);
    panels.value = data;
    selectedIndex.value = 0;
  } catch (err) {
    if (isNotFoundError(err)) {
      showError({ statusCode: 404, message: "未找到该展柜" });
      return;
    }
    loadError.value = true;
    message.error(resolveErrorMessage(err, "获取绝区零展柜失败"));
  } finally {
    loading.value = false;
    pageDataLoading.finish();
  }
};

const onSelect = (index: number) => {
  selectedIndex.value = index;
};

const refresh = () => {
  if (rawUid.value) {
    api.invalidateQueries(["zzz-panels", rawUid.value]);
  } else {
    api.invalidateQueries(["zzz-panels"]);
  }
  void loadPanels();
};

onMounted(() => {
  if (!isSelf.value || auth.isLogin) {
    void loadPanels();
  } else {
    loadError.value = true;
  }
});

watch(isSelf, () => {
  void loadPanels();
});

useSeoMeta({
  title: () => (selectedAvatar.value?.name ? `${selectedAvatar.value.name} - 绝区零展柜` : "绝区零展柜"),
  description: "在绳网查看绝区零角色展柜、属性、装备与伤害计算。",
});
</script>

<template>
  <div class="ik-zzz-panel">
    <div class="ik-zzz-panel__container">
      <div v-if="loading && !panels" class="ik-zzz-panel__skeleton">
        <div v-for="n in 8" :key="n" class="ik-skel" style="width:72px;height:96px;border-radius:12px"></div>
      </div>

      <div v-else-if="loadError && !panels" class="ik-zzz-panel__empty">
        <p>加载失败，请刷新重试</p>
        <z-button size="small" @click="refresh">刷新</z-button>
      </div>

      <div v-else-if="!loading && panels?.avatars.length === 0" class="ik-zzz-panel__empty">
        该展柜为空或已关闭
      </div>

      <template v-else-if="panels?.avatars.length">
        <ZzzPanelSwiper
          :avatars="panels.avatars"
          :model-value="selectedIndex"
          @update:model-value="onSelect"
        />

        <ZzzPanelDetail
          v-if="selectedAvatar"
          :uid="panels.uid"
          :region="panels.region"
          :avatar="selectedAvatar"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ik-zzz-panel {
  position: relative;
  width: 100%;
  min-height: 100vh;
  padding: 20px 0 calc(80px + env(safe-area-inset-bottom, 0px));
}

.ik-zzz-panel__container {
  max-width: 920px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-zzz-panel__skeleton {
  display: flex;
  gap: 12px;
  overflow: hidden;
  padding: 8px 0;
}

.ik-zzz-panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 20px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 15px;
}
</style>
