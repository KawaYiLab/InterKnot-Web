<script setup lang="ts">
import type { Profile } from "~/types/entities";

const props = defineProps<{
  authorId?: string;
}>();

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

// Simple in-memory cache
const profileCache = new Map<string, Profile>();

const fetchProfile = async (id: string) => {
  if (profileCache.has(id)) {
    profile.value = profileCache.get(id)!;
    return;
  }
  loading.value = true;
  fetchError.value = false;
  try {
    const data = await api.getProfile(id);
    profileCache.set(id, data);
    profile.value = data;
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
  const cardHeight = 300;
  const gap = 8;

  let top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - cardWidth / 2;

  // Flip above if not enough space below
  if (top + cardHeight > window.innerHeight - 16) {
    top = rect.top - gap - cardHeight;
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
    @mouseenter="onTriggerEnter"
    @mouseleave="onTriggerLeave"
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
        <!-- Loading state -->
        <div v-if="loading && !profile" class="ik-hovercard__loading">
          <div class="ik-hovercard__skel ik-hovercard__skel--banner" />
          <div class="ik-hovercard__loading-body">
            <div class="ik-hovercard__skel ik-hovercard__skel--avatar" />
            <div class="ik-hovercard__skel-lines">
              <div class="ik-hovercard__skel" style="width: 100px; height: 16px" />
              <div class="ik-hovercard__skel" style="width: 160px; height: 12px" />
            </div>
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
    </Transition>
  </Teleport>
</template>

<style scoped>
.ik-hovercard-trigger {
  display: inline-block;
  cursor: pointer;
}

/* ═══════════════════════════════════════════════
   Hover Card
   ═══════════════════════════════════════════════ */
.ik-hovercard {
  position: fixed;
  border-radius: 16px 0 16px 16px;
  background: #141414;
  border: 1px solid #2a2a2a;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.6),
    0 2px 8px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
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
  font-weight: 800;
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

.ik-hovercard__skel--banner {
  width: 100%;
  height: 90px;
  border-radius: 0;
}

.ik-hovercard__loading-body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.ik-hovercard__skel--avatar {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  flex-shrink: 0;
}

.ik-hovercard__skel-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  font-weight: 600;
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
