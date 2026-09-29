<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from "vue";
import { useEventListener } from "@vueuse/core";
import type { AcceptableValue, PointerDownOutsideEvent } from "reka-ui";
import type { Category } from "~/types/entities";
import {
  SparklesIcon,
  ClockIcon,
  FireIcon,
  BookmarkIcon,
  UserGroupIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
} from "@heroicons/vue/24/outline";
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsIndicator,
} from "reka-ui";
import Select from "./ui/select/Select.vue";
import SelectContent from "./ui/select/SelectContent.vue";
import SelectItem from "./ui/select/SelectItem.vue";
import SelectSeparator from "./ui/select/SelectSeparator.vue";
import SelectTrigger from "./ui/select/SelectTrigger.vue";
import SelectValue from "./ui/select/SelectValue.vue";

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

// ── 分区筛选（shadcn-vue Select） ──
// reka 的 SelectItem 不接受空串 value（空串保留给「清空选择」），「全部分区」用哨兵值占位，
// 进出组件时与 props.category 的空串互相转换。
const ALL_CATEGORIES = "__all__";

const categorySelectValue = computed(() => props.category || ALL_CATEGORIES);

// 当前分区名；分区列表异步到达前（或快照里的分区已下线）查不到时以「分区」占位，不误显示成「全部分区」。
const activeCategoryName = computed(
  () => props.categories.find((c) => c.slug === props.category)?.name ?? "分区",
);

const handleCategoryChange = (value: AcceptableValue) => {
  const slug = value === ALL_CATEGORIES ? "" : String(value ?? "");
  if (slug === props.category) return;
  emit("update:category", slug);
};

// 面板关闭时 reka 会把焦点还给触发器。它的聚焦链从 body 开始，浏览器会按键盘模式判定
// :focus-visible，鼠标 / 触屏选完后触发器外圈就会常驻一道焦点描边。这里记录最近一次输入方式：
// 指针操作关闭时仍把焦点还给触发器（读屏不丢位置），但声明不显示焦点环；键盘操作保持默认。
const categoryTriggerRef = ref<ComponentPublicInstance | null>(null);
let lastInputWasPointer = false;
useEventListener(document, "pointerdown", () => { lastInputWasPointer = true; }, { capture: true, passive: true });
useEventListener(document, "keydown", () => { lastInputWasPointer = false; }, { capture: true, passive: true });

const handleCategoryCloseAutoFocus = (event: Event) => {
  if (!lastInputWasPointer) return;
  const trigger = categoryTriggerRef.value?.$el as HTMLElement | undefined;
  if (!trigger) return;
  event.preventDefault();
  // focusVisible 不被支持的浏览器会忽略该字段，退化为原先的表现。
  trigger.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
};

// 面板挂载期间（含退场动画）reka 会给 body 加 pointer-events: none，面板外的点击都落在 <html> 上、
// 只用来关闭面板。这时若是双击（比如连点触发器），浏览器的双击选词会就近选中页面内容
// （实测会选中第一张帖子封面），故拦下这段时间内面板外左键按下的默认行为。
useEventListener(document, "mousedown", (event) => {
  if (event.button !== 0) return;
  const menu = document.querySelector(".ik-category-menu");
  if (!menu || menu.contains(event.target as Node)) return;
  event.preventDefault();
}, { capture: true });

// 双击触发器时，第二下会被当成「点击面板外」把刚打开的面板关掉（是否关闭还取决于两下的间隔）。
// 打开后很短时间内落在触发器上的外部按下不视为关闭，双击稳定地等于「打开」。
const DOUBLE_CLICK_GUARD_MS = 500;
let categoryOpenedAt = 0;

const handleCategoryOpenChange = (open: boolean) => {
  if (open) categoryOpenedAt = performance.now();
};

const handleCategoryPointerDownOutside = (event: PointerDownOutsideEvent) => {
  if (performance.now() - categoryOpenedAt > DOUBLE_CLICK_GUARD_MS) return;
  const rect = (categoryTriggerRef.value?.$el as HTMLElement | undefined)?.getBoundingClientRect();
  if (!rect) return;
  const { clientX, clientY } = event.detail.originalEvent;
  if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
    event.preventDefault();
  }
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
      <!-- 委托流 Tabs 与分区筛选是一组，始终同处一行（窄屏时整体收紧，不再把分区挤到第二行） -->
      <div class="ik-home-toolbar__nav">
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

        <!-- 分区筛选（shadcn-vue Select）。恒渲染、不随分区列表异步到达而出现/消失，避免下方瀑布流跳动；
             热门 / 关注 / 收藏下同样可选，选中分区即回到推荐流（见 index.vue 的 selectCategory）。
             外层轨道负责胶囊外观，触发器本身透明——与 Tabs 的「轨道 + 透明按钮」结构一致。 -->
        <Select
          :model-value="categorySelectValue"
          @update:model-value="handleCategoryChange"
          @update:open="handleCategoryOpenChange"
        >
          <div class="ik-category-track" :class="{ 'ik-category-track--active': !!category }">
            <SelectTrigger ref="categoryTriggerRef" class="ik-category-trigger" aria-label="委托分区">
              <Squares2X2Icon class="ik-category-trigger__icon" aria-hidden="true" />
              <SelectValue class="ik-category-trigger__value">
                <template v-if="category">{{ activeCategoryName }}</template>
                <!-- 窄屏只显示「分区」，「全部」两字仅做视觉隐藏（读屏仍读「全部分区」） -->
                <template v-else><span class="ik-category-trigger__all-prefix">全部</span>分区</template>
              </SelectValue>
            </SelectTrigger>
          </div>
          <SelectContent
            class="ik-category-menu"
            align="start"
            :side-offset="8"
            :collision-padding="12"
            @close-auto-focus="handleCategoryCloseAutoFocus"
            @pointer-down-outside="handleCategoryPointerDownOutside"
          >
            <SelectItem :value="ALL_CATEGORIES" class="ik-category-menu__item">全部分区</SelectItem>
            <template v-if="categories.length">
              <SelectSeparator class="ik-category-menu__separator" />
              <SelectItem
                v-for="cat in categories"
                :key="cat.slug"
                :value="cat.slug"
                class="ik-category-menu__item"
              >{{ cat.name }}</SelectItem>
            </template>
          </SelectContent>
        </Select>
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

/* [委托流 Tabs + 分区筛选] →（靠右）在线人数；放不下时只有在线人数折到第二行 */
.ik-home-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Tabs 与分区筛选同组不折行；空间不足时由分区触发器收缩（文字省略） */
.ik-home-toolbar__nav {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}

/* 主流切换分段器（基于 shadcn / reka Tabs） */
.ik-stream-tabs {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
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
  /* <button> 默认不继承字体（会回落到 Arial / 系统字体），显式继承站点品牌字体，
     与分区触发器、分区下拉面板保持一致 */
  font-family: inherit;
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

/* 分区筛选（shadcn-vue Select）：外层轨道与主流 Tabs 同款深色胶囊轨道（统一内边距与阴影），
   触发器在选中时变为亮绿药丸，尺寸与 Tab 按钮完全一致 */
.ik-category-track {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  background: #141414;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.ik-category-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 12px 0 14px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.ik-category-trigger:hover,
.ik-category-trigger[data-state="open"] {
  color: #ffffff;
}

.ik-category-trigger:focus-visible {
  outline: 2px solid rgba(191, 255, 9, 0.7);
  outline-offset: 2px;
}

/* 已选具体分区：内部触发器化为与左侧 Tab 滑块完全一致的亮绿药丸（高度 32px，嵌在深色轨道内） */
.ik-category-track--active .ik-category-trigger,
.ik-category-track--active .ik-category-trigger:hover,
.ik-category-track--active .ik-category-trigger[data-state="open"] {
  background: var(--ik-primary, #BFFF09);
  box-shadow: 0 0 14px rgba(191, 255, 9, 0.35);
  color: #000000;
  font-weight: 700;
}

.ik-category-trigger__icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  stroke-width: 2.2;
}

/* 极窄屏 + 长分区名放不下时以省略号截断，保证不折行 */
.ik-category-trigger__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

/* 箭头由 SelectTrigger 内部渲染，需 :deep 穿透；展开时翻转 */
.ik-category-trigger :deep([data-slot="select-icon"]) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-left: 2px;
  stroke-width: 2.4;
  opacity: 0.6;
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.15s ease;
}

.ik-category-trigger[data-state="open"] :deep([data-slot="select-icon"]) {
  transform: rotate(180deg);
  opacity: 0.9;
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

  .ik-home-toolbar__nav {
    gap: 8px;
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

  .ik-category-trigger {
    gap: 4px;
    height: 28px;
    padding: 0 10px 0 12px;
    font-size: 13px;
  }

  .ik-category-trigger__icon {
    width: 14px;
    height: 14px;
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

/* 手机宽度：委托流 Tabs 与分区筛选同处一行——两者都去掉图标（纯文字，风格一致），
   Tabs 撑满分区触发器之外的宽度，「全部分区」缩成「分区」 */
@media (max-width: 520px) {
  .ik-home-toolbar__nav {
    flex: 1 1 100%;
  }

  .ik-stream-tabs {
    flex: 1 0 auto;
  }

  .ik-stream-tab {
    flex: 1 1 0;
    padding: 0 10px;
  }

  .ik-stream-tab__icon,
  .ik-category-trigger__icon {
    display: none;
  }

  .ik-category-trigger__all-prefix {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
</style>

<style>
/* ── 分区下拉面板（shadcn-vue SelectContent）──
   面板经 Portal 挂到 body，已不在本组件的 scoped 作用域内，故这里不加 scoped，
   统一以 .ik-category-menu 前缀收口。 */
.ik-category-menu {
  position: relative;
  /* reka 会把这里的 z-index 同步到定位包裹层：高于顶栏(50)、新帖提示(90)、刷新按钮(100)，低于弹窗(9000) */
  z-index: 200;
  min-width: max(var(--reka-select-trigger-width), 168px);
  max-height: var(--reka-select-content-available-height);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 16px;
  background: #181818;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.55),
    0 2px 8px rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.78);
  /* 从触发器所在一侧展开（向上翻转时同样成立） */
  transform-origin: var(--reka-select-content-transform-origin);
}

/* reka 靠 animationend 决定何时卸载，进出场需用两段不同的 keyframes；退场比进场更快 */
.ik-category-menu[data-state="open"] {
  animation: ik-category-menu-in 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ik-category-menu[data-state="closed"] {
  animation: ik-category-menu-out 120ms ease-out forwards;
}

.ik-category-menu [data-reka-select-viewport] {
  padding: 6px;
}

.ik-category-menu__item {
  position: relative;
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 36px 0 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  outline: none;
  user-select: none;
  cursor: var(--ik-cursor-pointer);
  transition: background-color 0.12s ease, color 0.12s ease;
}

.ik-category-menu__item[data-highlighted] {
  background: rgba(255, 255, 255, 0.07);
  color: #ffffff;
}

.ik-category-menu__item[data-state="checked"] {
  color: var(--ik-primary, #BFFF09);
  font-weight: 700;
}

.ik-category-menu__item [data-slot="select-item-indicator"] {
  position: absolute;
  top: 50%;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
}

.ik-category-menu__item [data-slot="select-item-indicator"] svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.6;
}

.ik-category-menu__separator {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255, 255, 255, 0.07);
}

.ik-category-menu [data-slot="select-scroll-up-button"],
.ik-category-menu [data-slot="select-scroll-down-button"] {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-category-menu [data-slot="select-scroll-up-button"] svg,
.ik-category-menu [data-slot="select-scroll-down-button"] svg {
  width: 14px;
  height: 14px;
}

/* 触屏上放大点按区域 */
@media (pointer: coarse) {
  .ik-category-menu__item {
    height: 40px;
  }
}

@keyframes ik-category-menu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes ik-category-menu-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}

/* 减少动态：只保留淡入淡出提示状态变化，去掉缩放 */
@media (prefers-reduced-motion: reduce) {
  .ik-category-menu[data-state="open"] {
    animation-name: ik-category-menu-fade-in;
  }

  .ik-category-menu[data-state="closed"] {
    animation-name: ik-category-menu-fade-out;
  }
}

@keyframes ik-category-menu-fade-in {
  from {
    opacity: 0;
  }
}

@keyframes ik-category-menu-fade-out {
  to {
    opacity: 0;
  }
}
</style>
