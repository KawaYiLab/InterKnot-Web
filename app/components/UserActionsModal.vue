<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useBodyScrollLock } from "~/composables/useBodyScrollLock";

const props = defineProps<{
  canViewPosts?: boolean;
  canFollow?: boolean;
  isFollowing?: boolean;
  canSendDm?: boolean;
  canBlock?: boolean;
  isBlocked?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  posts: [];
  follow: [];
  dm: [];
  block: [];
}>();

// 拉黑按钮排在最后：前面按钮数为偶数时它独占一行，避免两列网格右侧空缺。
const blockSpansRow = computed(
  () => [props.canViewPosts, props.canFollow, props.canSendDm].filter(Boolean).length % 2 === 0,
);

const handleClose = () => {
  emit("close");
};

// 父页面负责先去掉 ?modal 再跳转，避免返回主页时菜单重新弹出。
const handlePosts = () => {
  emit("posts");
};

const handleFollow = () => {
  emit("follow");
  handleClose();
};

const handleDm = () => {
  emit("dm");
  handleClose();
};

const handleBlock = () => {
  emit("block");
  handleClose();
};

const handleOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    handleClose();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    handleClose();
  }
};

const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("user-actions-modal");

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  acquire(SCROLL_LOCK_TOKEN);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  release(SCROLL_LOCK_TOKEN);
});
</script>

<template>
  <div class="ik-overlay" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <div class="ik-dialog ik-dialog--actions" @click.stop>
      <div class="ik-dialog__outer">
        <div class="ik-dialog__inner">
          <!-- Header -->
          <div class="ik-dialog__header">
            <span class="ik-dialog__title">更多操作</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <!-- Body -->
          <div class="ik-dialog__body">
            <IkZzzMarquee />
            <div class="ik-actions__list">
              <z-button v-if="canViewPosts" @click="handlePosts">
                全部委托
              </z-button>
              <z-button v-if="canFollow" @click="handleFollow">
                {{ isFollowing ? "已关注" : "关注" }}
              </z-button>
              <z-button v-if="canSendDm" @click="handleDm">
                私信
              </z-button>
              <z-button
                v-if="canBlock"
                class="ik-actions__btn--block"
                :class="{ 'ik-actions__btn--span-2': blockSpansRow }"
                @click="handleBlock"
              >
                {{ isBlocked ? "取消拉黑" : "拉黑" }}
              </z-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.ik-overlay__stripe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

.ik-dialog {
  position: relative;
  width: 450px;
  max-width: 90%;
  height: 300px;
  max-height: 90%;
  will-change: transform;
}

.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ik-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px 24px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.ik-dialog__body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-actions__list {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  max-width: 336px;
  margin: 0 auto;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-actions__list :deep(.z-button) {
  width: 100%;
  box-sizing: border-box;
  margin-left: 0;
}

.ik-actions__btn--span-2 {
  grid-column: span 2;
}

@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
}
</style>
