<script setup lang="ts">
import { resolveErrorMessage } from "~/utils/api-error";
import type { Profile } from "~/types/entities";
import type { ComponentPublicInstance } from "vue";
import { useHoverCapable } from "~/composables/useHoverCapable";
import { useMessage } from "zenless-ui";

const props = withDefaults(defineProps<{
  authorId?: string;
  clickable?: boolean;
}>(), {
  clickable: false,
});

const hoverCapable = useHoverCapable();
// hover 用不到时（移动端/窄视口）不实例化 api，避免为每个评论/回复创建一次 cachedRead 闭包。
const api = hoverCapable.value ? useApi() : null;
// 移动端不需要 hover card 的私信/举报/登录弹窗，避免为每个 UserHoverCard 挂载 DM/弹窗相关状态。
const auth = hoverCapable.value ? useAuthStore() : null;
const loginDialog = hoverCapable.value ? useLoginDialog() : null;
const knockKnockModal = hoverCapable.value ? useKnockKnockModal() : null;
const dm = hoverCapable.value ? useDmConversations() : null;
const reportDialog = hoverCapable.value ? useReportDialog() : null;
const message = hoverCapable.value ? useMessage() : null;

const triggerRef = ref<HTMLElement | ComponentPublicInstance | null>(null);
const cardRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const profile = ref<Profile | null>(null);
const loading = ref(false);
const fetchError = ref(false);

/** "私信"按钮加载态 & 错误态：避免短时间内连点重复打开 direct API */
const dmStarting = ref(false);
const dmError = ref<string | null>(null);

/** 拉黑按钮加载态 */
const blockLoading = ref(false);

/** 自己不能给自己私信；双向拉黑或 profileHidden 用户后端也会拒，前端先隐 */
const canSendDm = computed<boolean>(() => {
  if (!profile.value) return false;
  if (profile.value.isSelf) return false;
  if (profile.value.profileHidden) return false;
  if (profile.value.isBlockedByMe || profile.value.hasBlockedMe) return false;
  // 没有 uid（极少数老数据）也禁用
  if (typeof profile.value.uid !== "number") return false;
  return true;
});

const canBlock = computed<boolean>(() => {
  const p = profile.value;
  if (!p) return false;
  if (p.isSelf) return false;
  if (p.isAiAgent) return false;
  if (typeof p.uid !== "number") return false;
  return true;
});

const canReport = computed<boolean>(() => {
  if (!profile.value) return false;
  if (profile.value.isSelf) return false;
  return typeof profile.value.uid === "number";
});

const reportUser = () => {
  const target = profile.value;
  if (!target || typeof target.uid !== "number") return;
  if (!auth?.isLogin) {
    loginDialog?.open();
    return;
  }
  visible.value = false;
  reportDialog?.open({
    targetType: "user",
    targetId: String(target.uid),
    targetLabel: `用户 ${target.name || target.login || ""}`.trim(),
  });
};

const cardStyle = ref<Record<string, string>>({});

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const SHOW_DELAY = 400;
const HIDE_DELAY = 250;



// Simple in-memory cache
const profileCache = new Map<string, Profile>();

const fetchProfile = async (id: string) => {
  if (!api) return;
  if (profileCache.has(id)) {
    profile.value = profileCache.get(id)!;
    nextTick(() => updatePosition());
    return;
  }
  loading.value = true;
  fetchError.value = false;
  try {
    const data = await api.getProfile(id);
    profileCache.set(id, data);
    profile.value = data;
    nextTick(() => updatePosition());
  } catch {
    fetchError.value = true;
  } finally {
    loading.value = false;
  }
};

const getTriggerEl = () => {
  const t = triggerRef.value;
  if (t instanceof HTMLElement) return t;
  return ((t as ComponentPublicInstance | null)?.$el as HTMLElement | undefined) || null;
};

const updatePosition = () => {
  const trigger = getTriggerEl();
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const cardWidth = 320;
  const card = cardRef.value;
  const cardHeight = card ? card.offsetHeight : 300;
  const gap = 8;

  let top = rect.top - gap - cardHeight;
  let left = rect.left + rect.width / 2 - cardWidth / 2;

  // Flip below if not enough space above
  if (top < 16) {
    top = rect.bottom + gap;
  }

  // Clamp horizontal
  if (left < 12) left = 12;
  if (left + cardWidth > window.innerWidth - 12) {
    left = window.innerWidth - 12 - cardWidth;
  }

  cardStyle.value = {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    width: `${cardWidth}px`,
    zIndex: "9999",
  };
};

const clearTimers = () => {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
};

const onTriggerEnter = () => {
  if (!props.authorId || !hoverCapable.value) return;
  clearTimers();
  showTimer = setTimeout(() => {
    visible.value = true;
    updatePosition();
    if (!profile.value || profile.value.documentId !== props.authorId) {
      fetchProfile(props.authorId!);
    }
  }, SHOW_DELAY);
};

const onTriggerLeave = () => {
  clearTimers();
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, HIDE_DELAY);
};

const onCardEnter = () => {
  clearTimers();
};

const onCardLeave = () => {
  clearTimers();
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, HIDE_DELAY);
};

const profileUrl = computed(() => props.authorId ? `/profile/${props.authorId}` : "");
const triggerEvents = computed(() => hoverCapable.value
  ? { mouseenter: onTriggerEnter, mouseleave: onTriggerLeave }
  : {});

const goProfile = () => {
  if (!props.authorId) return;
  visible.value = false;
  navigateTo(profileUrl.value);
};

/**
 * 发起私聊：
 *  1. 未登录 → 弹登录框
 *  2. canSendDm = false → 不应进到这里（按钮也会 disabled）
 *  3. 调 /api/dm/conversations/direct 找/建私聊
 *  4. 拿到 documentId 后打开敲敲弹窗并定位到该会话
 */
const startDm = async () => {
  if (!auth?.isLogin) {
    visible.value = false;
    loginDialog?.open();
    return;
  }
  if (!canSendDm.value || !profile.value || typeof profile.value.uid !== "number" || !dm) return;
  if (dmStarting.value) return;
  dmStarting.value = true;
  dmError.value = null;
  try {
    const { summary } = await dm.openDirectConversation(profile.value.uid);
    visible.value = false;
    knockKnockModal?.open({ dmConversationId: summary.documentId });
  } catch (err) {
    dmError.value = resolveErrorMessage(err, "无法发起私聊");
  } finally {
    dmStarting.value = false;
  }
};

const toggleBlock = async () => {
  const p = profile.value;
  if (!p?.documentId || !canBlock.value || !api) return;
  if (!auth?.isLogin) {
    visible.value = false;
    loginDialog?.open();
    return;
  }
  if (blockLoading.value) return;
  blockLoading.value = true;
  try {
    const result = await api.toggleUserBlock(p.documentId);
    const next: Profile = { ...p, isBlockedByMe: result.blocked };
    if (result.blocked) {
      next.isFollowing = false;
    }
    if (p.documentId) {
      if (result.blocked) {
        profileCache.set(p.documentId, next);
      } else {
        profileCache.delete(p.documentId);
      }
    }
    profile.value = next;
    message?.success(result.blocked ? "已拉黑" : "已取消拉黑");
    // 让个人页/列表缓存失效，刷新后应用拉黑过滤
    api.invalidateQueries(["profile"]);
    api.invalidateQueries(["articles"]);
  } catch (err) {
    message?.error(resolveErrorMessage(err, "操作失败"));
  } finally {
    blockLoading.value = false;
  }
};

const formatNumber = (n: number) => {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

onBeforeUnmount(() => {
  clearTimers();
});
</script>

<template>
  <NuxtLink
    v-if="clickable && authorId"
    :to="profileUrl"
    :prefetch="false"
    custom
  >
    <template #default="{ navigate }">
      <div
        ref="triggerRef"
        class="ik-hovercard-trigger"
        :class="{ 'ik-hovercard-trigger--clickable': clickable }"
        v-on="triggerEvents"
        @click="navigate"
      >
        <slot />
      </div>
    </template>
  </NuxtLink>
  <div
    v-else
    ref="triggerRef"
    class="ik-hovercard-trigger"
    :class="{ 'ik-hovercard-trigger--clickable': clickable }"
    v-on="triggerEvents"
    @click="clickable && goProfile()"
  >
    <slot />
  </div>

  <Teleport to="body">
    <Transition name="ik-hovercard">
      <div
        v-if="visible"
        ref="cardRef"
        class="ik-hovercard"
        :style="cardStyle"
        @mouseenter="onCardEnter"
        @mouseleave="onCardLeave"
      >
       <div class="ik-hovercard__outer">
        <div class="ik-hovercard__inner">
        <!-- Loading placeholder (mirrors profile layout to prevent size jump) -->
        <div v-if="loading && !profile" class="ik-hovercard__loading">
          <div class="ik-hovercard__banner">
            <div class="ik-hovercard__skel" style="width:100%;height:100%;border-radius:0" />
          </div>
          <div class="ik-hovercard__avatar-row">
            <div class="ik-hovercard__avatar-wrap">
              <div class="ik-hovercard__skel" style="width:52px;height:52px;border-radius:999px" />
            </div>
          </div>
          <div class="ik-hovercard__body">
            <div class="ik-hovercard__skel" style="width:100px;height:16px" />
            <div class="ik-hovercard__skel" style="width:160px;height:12px;margin-top:6px" />
          </div>
          <div class="ik-hovercard__stats">
            <div v-for="i in 3" :key="i" class="ik-hovercard__stat">
              <div class="ik-hovercard__skel" style="width:32px;height:15px" />
              <div class="ik-hovercard__skel" style="width:24px;height:11px" />
            </div>
          </div>
          <div class="ik-hovercard__footer">
            <div class="ik-hovercard__skel" style="width:100%;height:30px;border-radius:8px" />
          </div>
        </div>

        <!-- Profile content -->
        <template v-else-if="profile">
          <!-- Top banner (business card) -->
          <div
            class="ik-hovercard__banner"
            :class="{ 'ik-hovercard__banner--has-image': profile.equippedCard?.image }"
            @click="goProfile"
          >
            <img
              :src="profile.equippedCard?.image || '/images/banner.png'"
              alt=""
              class="ik-hovercard__banner-img"
            />
          </div>

          <!-- Avatar (overlapping banner) -->
          <div class="ik-hovercard__avatar-row">
            <div class="ik-hovercard__avatar-wrap" @click="goProfile">
              <img
                :src="profile.avatar || '/images/default-avatar.webp'"
                alt=""
                class="ik-hovercard__avatar"
                @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
              />
              <span class="ik-hovercard__level">{{ profile.level || 1 }}</span>
            </div>
          </div>

          <!-- Info -->
          <div class="ik-hovercard__body">
            <div class="ik-hovercard__name-row" @click="goProfile">
              <span class="ik-hovercard__name">{{ profile.name || profile.login || "匿名用户" }}</span>
            </div>
            <p v-if="profile.bio" class="ik-hovercard__bio">{{ profile.bio }}</p>
            <p v-else class="ik-hovercard__bio ik-hovercard__bio--empty">这个人很神秘，什么都没有留下。</p>
          </div>

          <div v-if="profile.stats" class="ik-hovercard__stats">
            <div class="ik-hovercard__stat">
              <span class="ik-hovercard__stat-num">{{ formatNumber(profile.stats.totalViews) }}</span>
              <span class="ik-hovercard__stat-label">浏览</span>
            </div>
            <div class="ik-hovercard__stat">
              <span class="ik-hovercard__stat-num">{{ formatNumber(profile.stats.totalLikes) }}</span>
              <span class="ik-hovercard__stat-label">获赞</span>
            </div>
            <div class="ik-hovercard__stat">
              <span class="ik-hovercard__stat-num">{{ formatNumber(profile.stats.articleCount) }}</span>
              <span class="ik-hovercard__stat-label">委托</span>
            </div>
          </div>

          <div class="ik-hovercard__footer">
            <div v-if="dmError" class="ik-hovercard__dm-error" role="alert">
              {{ dmError }}
            </div>
            <div class="ik-hovercard__footer-actions">
              <button
                v-if="canSendDm"
                type="button"
                class="ik-hovercard__send-dm-btn"
                :disabled="dmStarting"
                @click="startDm"
              >
                {{ dmStarting ? "..." : "私信" }}
              </button>
              <button class="ik-hovercard__profile-btn" @click="goProfile">查看主页</button>
              <button
                v-if="canReport"
                type="button"
                class="ik-hovercard__report-btn"
                title="举报用户"
                @click="reportUser"
              >
                举报
              </button>
              <button
                v-if="canBlock"
                type="button"
                class="ik-hovercard__block-btn"
                :class="{ 'ik-hovercard__block-btn--blocked': profile?.isBlockedByMe }"
                :disabled="blockLoading"
                @click="toggleBlock"
              >
                {{ blockLoading ? "..." : (profile?.isBlockedByMe ? "取消拉黑" : "拉黑") }}
              </button>
            </div>
          </div>
        </template>

        <!-- Error state -->
        <div v-else-if="fetchError" class="ik-hovercard__error">
          加载失败
        </div>
        </div>
       </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ik-hovercard-trigger {
  display: inline-block;
  text-decoration: none;
  color: inherit;
}

.ik-hovercard-trigger--clickable {
  cursor: pointer;
}

.ik-hovercard-trigger--clickable:hover {
  opacity: 0.85;
}

/* ═══════════════════════════════════════════════
   Hover Card
   ═══════════════════════════════════════════════ */
.ik-hovercard {
  position: fixed;
  border-radius: 18px 0 18px 18px;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.6),
    0 2px 8px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  transition: top 200ms ease, left 200ms ease;
}

/* 外边框 */
.ik-hovercard__outer {
  width: 100%;
  height: 100%;
  padding: 3px;
  background: #2D2C2D;
  border-radius: 18px 0 18px 18px;
  overflow: hidden;
}

/* 内边框 */
.ik-hovercard__inner {
  width: 100%;
  height: 100%;
  background: #141414;
  border: 3px solid #000;
  border-radius: 16px 0 16px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Top Banner ───────────────────────────────── */
.ik-hovercard__banner {
  position: relative;
  width: 100%;
  height: 90px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
}

.ik-hovercard__banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ── Avatar row (overlapping banner) ──────────── */
.ik-hovercard__avatar-row {
  position: relative;
  padding: 0 16px;
  margin-top: -26px;
  z-index: 1;
}

.ik-hovercard__avatar-wrap {
  position: relative;
  display: inline-block;
  cursor: pointer;
}

.ik-hovercard__avatar {
  width: 52px;
  height: 52px;
  border-radius: 999px;
  object-fit: cover;
  background: #1b1b1b;
  border: 3px solid #141414;
}

.ik-hovercard__level {
  position: absolute;
  bottom: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #BFFF09;
  color: #000;
  font-size: 10px;
  font-weight: 900;
  font-style: italic;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ── Body (name + bio) ────────────────────────── */
.ik-hovercard__body {
  padding: 8px 16px 4px;
}

.ik-hovercard__name-row {
  cursor: pointer;
}

.ik-hovercard__name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-hovercard__name:hover {
  color: #BFFF09;
}

.ik-hovercard__bio {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.5);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.ik-hovercard__bio--empty {
  font-style: italic;
  color: rgba(255, 255, 255, 0.25);
}

/* ── Loading skeleton ─────────────────────────── */
.ik-hovercard__loading {
  display: flex;
  flex-direction: column;
}

.ik-hovercard__skel {
  background: #222;
  border-radius: 6px;
  animation: ik-hovercard-pulse 1.2s ease-in-out infinite;
}


@keyframes ik-hovercard-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

/* ── Stats ─────────────────────────────────────── */
.ik-hovercard__stats {
  position: relative;
  display: flex;
  justify-content: space-around;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-hovercard__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.ik-hovercard__stat-num {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.ik-hovercard__stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Footer ────────────────────────────────────── */
.ik-hovercard__footer {
  position: relative;
  padding: 0 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-hovercard__footer-actions {
  display: flex;
  gap: 8px;
}

.ik-hovercard__profile-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.ik-hovercard__report-btn {
  flex-shrink: 0;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.ik-hovercard__report-btn:hover {
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.4);
  color: #ff6b6b;
}

.ik-hovercard__block-btn {
  flex-shrink: 0;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.ik-hovercard__block-btn:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.1);
  border-color: rgba(255, 80, 80, 0.4);
  color: #ff8080;
}

.ik-hovercard__block-btn--blocked {
  color: #ff8080;
  border-color: rgba(255, 80, 80, 0.3);
}

.ik-hovercard__block-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ik-hovercard__profile-btn:hover {
  background: rgba(215, 255, 0, 0.1);
  border-color: rgba(215, 255, 0, 0.3);
  color: #BFFF09;
}

/* 主操作：私信（黄底黑字，强调） */
.ik-hovercard__send-dm-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #fbfe00;
  border-radius: 8px;
  background: #fbfe00;
  color: #000;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, transform 80ms ease, opacity 140ms ease;
}

.ik-hovercard__send-dm-btn:hover:not(:disabled) {
  background: #e8eb00;
  border-color: #e8eb00;
}

.ik-hovercard__send-dm-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.ik-hovercard__send-dm-btn:disabled {
  background: rgba(251, 254, 0, 0.35);
  border-color: rgba(251, 254, 0, 0.35);
  color: rgba(0, 0, 0, 0.55);
  cursor: not-allowed;
}

.ik-hovercard__dm-error {
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 80, 80, 0.15);
  color: #ff8080;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

/* ── Error ─────────────────────────────────────── */
.ik-hovercard__error {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Transitions ───────────────────────────────── */
.ik-hovercard-enter-active {
  transition: opacity 160ms ease-out, transform 160ms ease-out;
}

.ik-hovercard-leave-active {
  transition: opacity 120ms ease-in, transform 120ms ease-in;
}

.ik-hovercard-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}

.ik-hovercard-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}
</style>
