<script setup lang="ts">
import type { Profile } from "~/types/entities";

const props = withDefaults(defineProps<{
  authorId?: string;
  clickable?: boolean;
}>(), {
  clickable: false,
});

const api = useApi();

const triggerRef = ref<HTMLElement | null>(null);
const cardRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const profile = ref<Profile | null>(null);
const loading = ref(false);
const fetchError = ref(false);

const cardStyle = ref<Record<string, string>>({});

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const SHOW_DELAY = 400;
const HIDE_DELAY = 250;

// Skip the hover card on touch devices / narrow viewports — mouseenter can
// still fire on iOS after a tap, which previously caused an unwanted popup.
const isMobileEnv = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none), (pointer: coarse), (max-width: 768px)").matches;
};

// Simple in-memory cache
const profileCache = new Map<string, Profile>();

const fetchProfile = async (id: string) => {
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

const updatePosition = () => {
  const trigger = triggerRef.value;
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
  if (!props.authorId) return;
  // Never show the hover card on touch devices / narrow viewports.
  if (isMobileEnv()) return;
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

const goProfile = () => {
  if (!props.authorId) return;
  visible.value = false;
  navigateTo(`/profile/${props.authorId}`);
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
  <div
    ref="triggerRef"
    class="ik-hovercard-trigger"
    :class="{ 'ik-hovercard-trigger--clickable': clickable }"
    @mouseenter="onTriggerEnter"
    @mouseleave="onTriggerLeave"
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
              <span class="ik-hovercard__stat-label">帖子</span>
            </div>
          </div>

          <div class="ik-hovercard__footer">
            <button class="ik-hovercard__profile-btn" @click="goProfile">查看主页</button>
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
  background: #d7ff00;
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
  color: #d7ff00;
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
  justify-content: center;
}

.ik-hovercard__profile-btn {
  width: 100%;
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

.ik-hovercard__profile-btn:hover {
  background: rgba(215, 255, 0, 0.1);
  border-color: rgba(215, 255, 0, 0.3);
  color: #d7ff00;
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
