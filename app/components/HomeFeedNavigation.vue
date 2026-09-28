<script setup lang="ts">
import { computed } from "vue";
import type { Category } from "~/types/entities";
import {
  SparklesIcon,
  ClockIcon,
  FireIcon,
  BookmarkIcon,
  UserGroupIcon,
  MagnifyingGlassIcon,
} from "@heroicons/vue/24/outline";
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsIndicator,
} from "reka-ui";

defineOptions({
  name: "HomeFeedNavigation",
});

interface Props {
  modelValue: string;
  category?: string;
  categories?: Category[];
  searching?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  category: "",
  categories: () => [],
  searching: false,
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:category", value: string): void;
}>();

const FEED_PANEL_ID = "ik-home-feed-panel";

const auth = useAuthStore();
const loginDialog = useLoginDialog();
const { online: presenceOnline, avatars: presenceAvatars } = usePresence();

const PRESENCE_AVATAR_MAX = 5;
const presenceShownAvatars = computed(() => presenceAvatars.value.slice(0, PRESENCE_AVATAR_MAX));
const presenceOverflow = computed(() =>
  Math.max(0, presenceOnline.value - presenceShownAvatars.value.length),
);

interface NavTab {
  key: string;
  label: string;
  icon: any;
}

const mainNavTabs = computed<NavTab[]>(() => {
  if (props.searching) {
    return [
      { key: "search", label: "搜索结果", icon: MagnifyingGlassIcon },
      { key: "following", label: "关注", icon: UserGroupIcon },
      { key: "favorites", label: "收藏", icon: BookmarkIcon },
    ];
  }
  return [
    { key: "recommend", label: "推荐", icon: SparklesIcon },
    { key: "latest", label: "最新", icon: ClockIcon },
    { key: "hot", label: "热门", icon: FireIcon },
    { key: "following", label: "关注", icon: UserGroupIcon },
    { key: "favorites", label: "收藏", icon: BookmarkIcon },
  ];
});

let lastLoginOpenTime = 0;
const openLoginDialogOnce = () => {
  const now = Date.now();
  if (now - lastLoginOpenTime > 150) {
    lastLoginOpenTime = now;
    loginDialog.open();
  }
};

const handleTriggerPointerDown = (key: string, event: Event) => {
  if ((key === "following" || key === "favorites") && !auth.isLogin) {
    event.preventDefault();
    event.stopPropagation();
    openLoginDialogOnce();
  }
};

const handleTriggerKeyDown = (key: string, event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    if ((key === "following" || key === "favorites") && !auth.isLogin) {
      event.preventDefault();
      event.stopPropagation();
      openLoginDialogOnce();
    }
  }
};

const handleTabChange = (val: string | number) => {
  const tabKey = String(val);
  if (tabKey === props.modelValue) return;

  if (tabKey === "following" || tabKey === "favorites") {
    if (!auth.isLogin) {
      openLoginDialogOnce();
      return;
    }
  }

  emit("update:modelValue", tabKey);
};
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    activation-mode="manual"
    class="ik-home-nav-hub"
    @update:model-value="handleTabChange"
  >
    <div class="ik-home-toolbar">
      <div class="ik-home-toolbar__controls">
        <!-- 主流切换 Tabs（推荐 / 最新 / 热门 / 关注 / 收藏） -->
        <TabsList class="ik-stream-tabs" aria-label="委托流模式">
          <TabsIndicator class="ik-tabs-indicator" />
          <TabsTrigger
            v-for="t in mainNavTabs"
            :key="t.key"
            :value="t.key"
            as-child
          >
            <button
              type="button"
              :id="'ik-tab-' + t.key"
              :aria-controls="FEED_PANEL_ID"
              class="ik-stream-tab"
              @pointerdown="handleTriggerPointerDown(t.key, $event)"
              @mousedown="handleTriggerPointerDown(t.key, $event)"
              @keydown="handleTriggerKeyDown(t.key, $event)"
            >
              <component :is="t.icon" class="ik-stream-tab__icon" aria-hidden="true" />
              {{ t.label }}
            </button>
          </TabsTrigger>
        </TabsList>
      </div>

      <!-- 在线人数：🟢 N 在线 + 头像堆叠 +N -->
      <div v-if="presenceOnline > 10" class="ik-online" aria-label="在线人数">
        <span class="ik-online__dot" aria-hidden="true" />
        <span class="ik-online__count">{{ presenceOnline }} 在线</span>
        <div v-if="presenceShownAvatars.length" class="ik-online__stack" aria-hidden="true">
          <img
            v-for="(url, i) in presenceShownAvatars"
            :key="url + i"
            :src="url"
            class="ik-online__avatar"
            alt=""
            loading="lazy"
          />
          <span v-if="presenceOverflow > 0" class="ik-online__more">+{{ presenceOverflow }}</span>
        </div>
      </div>
    </div>

    <!-- Feed 内容主体（作为 Persistent TabPanel） -->
    <div
      role="tabpanel"
      :id="FEED_PANEL_ID"
      :aria-labelledby="'ik-tab-' + modelValue"
      class="ik-feed-panel"
    >
      <slot />
    </div>
  </TabsRoot>
</template>

<style scoped>
/* 顶部导航控制台 */
.ik-home-nav-hub {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.ik-home-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

/* 主流切换分段器（基于 shadcn / reka Tabs） */
.ik-stream-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  background: #141414;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  padding: 3px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

/* 动态滑动高亮指示器 */
.ik-tabs-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: var(--reka-tabs-indicator-size);
  transform: translateX(var(--reka-tabs-indicator-position));
  background: var(--ik-primary, #BFFF09);
  border-radius: 9999px;
  box-shadow: 0 0 14px rgba(191, 255, 9, 0.35);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  z-index: 1;
}

/* 单个 Tab 按钮 */
.ik-stream-tab {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, transform 0.1s ease;
}

.ik-stream-tab:hover {
  color: #ffffff;
}

.ik-stream-tab:active {
  transform: scale(0.96);
}

.ik-stream-tab[data-state="active"],
.ik-stream-tab[aria-selected="true"] {
  color: #000000;
  font-weight: 700;
}

.ik-stream-tab__icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  stroke-width: 2.2;
}

.ik-home-toolbar__controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 在线人数：🟢 N 在线 + 头像堆叠 +N */
.ik-online {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  align-self: center;
  margin-left: auto;
  padding-left: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}

.ik-online__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.18);
  flex-shrink: 0;
}

.ik-online__count {
  font-feature-settings: "tnum";
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
}

.ik-online__stack {
  display: inline-flex;
  align-items: center;
}

.ik-online__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #1c1c1c;
  background: #2a2a2a;
  margin-left: -8px;
}

.ik-online__avatar:first-child {
  margin-left: 0;
}

.ik-online__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  margin-left: -8px;
  padding: 0 6px;
  border-radius: 9999px;
  border: 2px solid #1c1c1c;
  background: #333;
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-weight: 700;
  font-feature-settings: "tnum";
}

@media (max-width: 768px) {
  .ik-home-nav-hub {
    gap: 10px;
    margin-bottom: 14px;
  }

  .ik-home-toolbar {
    gap: 10px;
  }

  .ik-stream-tab {
    height: 28px;
    padding: 0 12px;
    font-size: 13px;
  }

  .ik-stream-tab__icon {
    width: 14px;
    height: 14px;
  }

  .ik-home-toolbar__controls {
    gap: 8px;
  }

  .ik-online {
    gap: 6px;
    padding-left: 8px;
    font-size: 12px;
  }

  .ik-online__avatar,
  .ik-online__more {
    width: 22px;
    height: 22px;
    min-width: 22px;
  }
}
</style>
