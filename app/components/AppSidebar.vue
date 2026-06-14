<template>
  <aside class="ik-sidebar" aria-label="侧边信息栏">
    <!-- 站点信息模块（原页脚信息侧栏化，主页常驻可见） -->
    <SidebarSection :title="SITE_BRAND">
      <p class="ik-sidebar__tagline">{{ SITE_TAGLINE }}</p>

      <div class="ik-sidebar__links">
        <div
          v-for="group in siteLinkGroups"
          :key="group.heading"
          class="ik-sidebar__group"
        >
          <h4 class="ik-sidebar__heading">{{ group.heading }}</h4>
          <ul class="ik-sidebar__list">
            <li v-for="link in group.links" :key="link.href">
              <a :href="link.href" target="_blank" rel="noopener noreferrer">
                {{ link.label }}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <p class="ik-sidebar__copy">{{ siteCopyright() }}</p>
    </SidebarSection>

    <!--
      后续功能模块在此追加，例如：
      <SidebarSection title="公告"> ... </SidebarSection>
      <SidebarSection title="热门标签"> ... </SidebarSection>
      <SidebarSection title="排行榜"> ... </SidebarSection>
      每个模块各自取数、独立成组件，塞进侧栏即可。
    -->
  </aside>
</template>

<script setup lang="ts">
import {
  SITE_BRAND,
  SITE_TAGLINE,
  siteCopyright,
  siteLinkGroups,
} from "~/utils/site-links";
</script>

<style scoped>
.ik-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-sidebar__tagline {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.6;
  color: #888;
}

.ik-sidebar__links {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-sidebar__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-sidebar__heading {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: #aaa;
  letter-spacing: 0.5px;
}

.ik-sidebar__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ik-sidebar__list a {
  color: #888;
  text-decoration: none;
  font-size: 13px;
  transition: color 0.2s;
}

.ik-sidebar__list a:hover {
  color: var(--ik-primary, #bfff09);
}

.ik-sidebar__copy {
  margin: 16px 0 0;
  font-size: 12px;
  color: #666;
}
</style>
