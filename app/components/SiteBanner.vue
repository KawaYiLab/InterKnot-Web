<script setup lang="ts">
import { XMarkIcon } from "@heroicons/vue/24/outline";

/** 顶栏下方的站点横幅：只读维护提示（不能关）与后台公告（可以关）。 */
const { announcement, readOnly, dismiss } = useSiteStatus();

// 后端只收 http(s) 链接；这里再挡一次，避免 javascript: 之类进 href。
const isHttp = (link: string) => /^https?:\/\//i.test(link);
</script>

<template>
  <ClientOnly>
    <div v-if="readOnly || announcement" class="ik-site-banner">
      <div v-if="readOnly" class="ik-site-banner__bar is-warning" role="status">
        <span class="ik-site-banner__tag">维护中</span>
        <span class="ik-site-banner__text">{{ readOnly.message }}</span>
      </div>
      <div
        v-if="announcement"
        :class="['ik-site-banner__bar', { 'is-warning': announcement.tone === 'warning' && !readOnly }]"
        role="status"
      >
        <span class="ik-site-banner__tag">公告</span>
        <a
          v-if="announcement.link && isHttp(announcement.link)"
          class="ik-site-banner__text is-link"
          :href="announcement.link"
          target="_blank"
          rel="noopener noreferrer"
        >{{ announcement.text }}</a>
        <span v-else class="ik-site-banner__text">{{ announcement.text }}</span>
        <button type="button" class="ik-site-banner__close" aria-label="关闭公告" @click="dismiss">
          <XMarkIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  </ClientOnly>
</template>

<style scoped>
.ik-site-banner {
  display: flex;
  flex-direction: column;
}

.ik-site-banner__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 8px 32px;
  background: #151515;
  border-bottom: 1px solid #2a2a2a;
  color: var(--ik-text);
  font-size: 14px;
  line-height: 1.5;
}

.ik-site-banner__bar.is-warning {
  background: var(--ik-primary);
  border-bottom-color: #000;
  color: #000;
}

.ik-site-banner__tag {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--ik-primary);
  color: #000;
  font-size: 12px;
  font-weight: 700;
}

.is-warning .ik-site-banner__tag {
  background: #000;
  color: var(--ik-primary);
}

.ik-site-banner__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: inherit;
}

.ik-site-banner__text.is-link {
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: var(--ik-cursor-pointer);
}

.ik-site-banner__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: var(--ik-cursor-pointer);
}

.ik-site-banner__close:hover {
  opacity: 1;
  background: rgb(127 127 127 / 0.18);
}

.ik-site-banner__close svg {
  width: 18px;
  height: 18px;
}

@media (max-width: 768px) {
  .ik-site-banner__bar {
    padding: 8px 16px;
    font-size: 13px;
  }
}
</style>
