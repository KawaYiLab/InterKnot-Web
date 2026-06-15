<template>
  <div class="ik-menu-trigger-wrap">
    <button
      type="button"
      class="ik-menu-btn"
      aria-label="菜单"
      @click="drawerVisible = true"
    >
      <Bars3Icon class="ik-menu-btn__icon" aria-hidden="true" />
      <span class="ik-menu-btn__text">菜单</span>
    </button>

    <z-drawer
      v-model="drawerVisible"
      title="站点信息"
      :show-footer="false"
      width="320"
    >
      <div class="ik-menu-drawer">
        <p class="ik-menu-drawer__tagline">{{ SITE_TAGLINE }}</p>

        <div class="ik-menu-drawer__links">
          <div
            v-for="group in siteLinkGroups"
            :key="group.heading"
            class="ik-menu-drawer__group"
          >
            <h4 class="ik-menu-drawer__heading">{{ group.heading }}</h4>
            <ul class="ik-menu-drawer__list">
              <li v-for="link in group.links" :key="link.href">
                <a :href="link.href" target="_blank" rel="noopener noreferrer">
                  {{ link.label }}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p class="ik-menu-drawer__copy">{{ siteCopyright() }}</p>
      </div>
    </z-drawer>
  </div>
</template>

<script setup lang="ts">
import { Bars3Icon } from "@heroicons/vue/24/outline";
import {
  SITE_TAGLINE,
  siteCopyright,
  siteLinkGroups,
} from "~/utils/site-links";

const drawerVisible = ref(false);
</script>

<style scoped>
.ik-menu-trigger-wrap {
  display: flex;
  align-items: center;
}

.ik-menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  border: 2px solid #333;
  background: #1a1a1a;
  color: #ccc;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.ik-menu-btn:hover {
  border-color: var(--ik-primary, #bfff09);
  color: #fff;
  background: #222;
}

.ik-menu-btn__icon {
  width: 18px;
  height: 18px;
}

.ik-menu-btn__text {
  display: none;
}

@media (min-width: 769px) {
  .ik-menu-btn__text {
    display: inline;
  }
}

.ik-menu-drawer {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}

.ik-menu-drawer__tagline {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #888;
}

.ik-menu-drawer__links {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ik-menu-drawer__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-menu-drawer__heading {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: #aaa;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.ik-menu-drawer__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-menu-drawer__list a {
  color: #999;
  text-decoration: none;
  font-size: 14px;
  transition: color 0.2s;
}

.ik-menu-drawer__list a:hover {
  color: var(--ik-primary, #bfff09);
}

.ik-menu-drawer__copy {
  margin: 8px 0 0;
  font-size: 12px;
  color: #666;
}
</style>
