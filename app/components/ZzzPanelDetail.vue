<script setup lang="ts">
import type { ZzzPanelAvatar } from "~/types/entities";

defineProps<{
  uid: string;
  region: string;
  avatar: ZzzPanelAvatar;
}>();

const activeTab = ref("properties");

const elementLabel: Record<string, string> = {
  physical: "物理",
  fire: "火",
  ice: "冰",
  electric: "电",
  ether: "以太",
};

const professionLabel: Record<string, string> = {
  attack: "强攻",
  stun: "击破",
  anomaly: "异常",
  support: "支援",
  defense: "防护",
  rupture: "命破",
};

const skillLevelSum = (avatar: ZzzPanelAvatar) =>
  avatar.skills.reduce((sum, s) => sum + s.level, 0);
</script>

<template>
  <div class="ik-zzz-detail">
    <div class="ik-zzz-detail__header">
      <img
        :src="avatar.iconUrls.portrait || avatar.iconUrls.square || '/images/default-avatar.webp'"
        alt=""
        class="ik-zzz-detail__portrait"
        @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
      />
      <div class="ik-zzz-detail__info">
        <div class="ik-zzz-detail__title-row">
          <h1 class="ik-zzz-detail__name">{{ avatar.name }}</h1>
          <span class="ik-zzz-detail__rarity">{{ avatar.rarityName }}</span>
        </div>
        <div class="ik-zzz-detail__badges">
          <span class="ik-zzz-detail__badge" :class="`is-${avatar.element}`">{{ elementLabel[avatar.element] || avatar.element }}</span>
          <span class="ik-zzz-detail__badge is-profession">{{ professionLabel[avatar.profession] || avatar.profession }}</span>
          <span class="ik-zzz-detail__badge">Lv.{{ avatar.level }}</span>
          <span class="ik-zzz-detail__badge">影画 {{ avatar.mindscape }}</span>
          <span class="ik-zzz-detail__badge">核心技 {{ avatar.coreSkill }}</span>
        </div>
        <div class="ik-zzz-detail__meta">
          <span v-if="avatar.weapon">{{ avatar.weapon.name }} Lv.{{ avatar.weapon.level }} · {{ avatar.weapon.rarityName }}</span>
          <span>技能等级和 {{ skillLevelSum(avatar) }}</span>
        </div>
        <div class="ik-zzz-detail__scores">
          <div class="ik-zzz-detail__score">
            <span class="ik-zzz-detail__score-label">驱动盘评分</span>
            <span class="ik-zzz-detail__score-value">{{ avatar.score.total }}<span class="ik-zzz-detail__score-max">/{{ avatar.score.max }}</span></span>
            <span class="ik-zzz-detail__score-comment">{{ avatar.score.comment }}</span>
          </div>
          <div class="ik-zzz-detail__score">
            <span class="ik-zzz-detail__score-label">练度评分</span>
            <span class="ik-zzz-detail__score-value">{{ avatar.score.proficiencyScore }}</span>
          </div>
          <div class="ik-zzz-detail__score">
            <span class="ik-zzz-detail__score-label">伤害指数</span>
            <span class="ik-zzz-detail__score-value">{{ Math.round(avatar.damage.damageIndex || 0) }}</span>
          </div>
        </div>
      </div>
    </div>

    <z-tabs v-model="activeTab" class="ik-zzz-detail__tabs">
      <z-tab-panel label="属性" name="properties">
        <ZzzPanelProperties :properties="avatar.properties" />
      </z-tab-panel>
      <z-tab-panel label="装备" name="equip">
        <ZzzPanelWeapon :weapon="avatar.weapon" />
        <ZzzPanelDriveDiscs :discs="avatar.discs" />
      </z-tab-panel>
      <z-tab-panel label="伤害" name="damage">
        <ZzzPanelDamage :damage="avatar.damage" />
      </z-tab-panel>
    </z-tabs>
  </div>
</template>

<style scoped>
.ik-zzz-detail {
  background: rgba(18, 18, 20, 0.82);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.ik-zzz-detail__header {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent);
}

.ik-zzz-detail__portrait {
  width: 120px;
  height: 140px;
  object-fit: cover;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.ik-zzz-detail__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ik-zzz-detail__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-zzz-detail__name {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #fff;
}

.ik-zzz-detail__rarity {
  font-size: 12px;
  font-weight: 800;
  color: #fbfe00;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(251, 254, 0, 0.12);
}

.ik-zzz-detail__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ik-zzz-detail__badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
}

.ik-zzz-detail__badge.is-physical { background: rgba(209, 179, 255, 0.15); color: #d1b3ff; }
.ik-zzz-detail__badge.is-fire { background: rgba(255, 158, 128, 0.15); color: #ff9e80; }
.ik-zzz-detail__badge.is-ice { background: rgba(128, 223, 255, 0.15); color: #80dfff; }
.ik-zzz-detail__badge.is-electric { background: rgba(194, 255, 128, 0.15); color: #c2ff80; }
.ik-zzz-detail__badge.is-ether { background: rgba(255, 128, 212, 0.15); color: #ff80d4; }
.ik-zzz-detail__badge.is-profession { background: rgba(255, 255, 255, 0.12); color: #fff; }

.ik-zzz-detail__meta {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.ik-zzz-detail__scores {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: auto;
  padding-top: 8px;
}

.ik-zzz-detail__score {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 90px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.25);
}

.ik-zzz-detail__score-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.ik-zzz-detail__score-value {
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
}

.ik-zzz-detail__score-max {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
}

.ik-zzz-detail__score-comment {
  font-size: 12px;
  font-weight: 700;
  color: #fbfe00;
}

.ik-zzz-detail__tabs {
  padding: 0 16px 20px;
}

@media (max-width: 640px) {
  .ik-zzz-detail__header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .ik-zzz-detail__portrait {
    width: 100%;
    max-width: 160px;
    height: 180px;
  }
  .ik-zzz-detail__scores {
    justify-content: center;
  }
}
</style>
