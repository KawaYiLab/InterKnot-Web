<script setup lang="ts">
import type { ZzzPanelWeapon as ZzzWeapon } from "~/types/entities";

defineProps<{
  weapon: ZzzWeapon | null;
}>();
</script>

<template>
  <div class="ik-zzz-weapon">
    <div v-if="!weapon" class="ik-zzz-weapon__empty">未装备音擎</div>
    <template v-else>
      <div class="ik-zzz-weapon__main">
        <img
          :src="weapon.iconUrl || '/images/default-avatar.webp'"
          alt=""
          class="ik-zzz-weapon__icon"
          loading="lazy"
          @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
        />
        <div class="ik-zzz-weapon__info">
          <div class="ik-zzz-weapon__name">{{ weapon.name }}</div>
          <div class="ik-zzz-weapon__meta">
            <span class="ik-zzz-weapon__rarity">{{ weapon.rarityName }}</span>
            <span>Lv.{{ weapon.level }}</span>
            <span>{{ weapon.star }} 星</span>
          </div>
        </div>
      </div>
      <div class="ik-zzz-weapon__stats">
        <div v-for="stat in weapon.mainStat" :key="stat.propertyId" class="ik-zzz-weapon__stat">
          <span class="ik-zzz-weapon__stat-name">{{ stat.name }}</span>
          <span class="ik-zzz-weapon__stat-value">{{ stat.displayValue }}</span>
        </div>
        <div v-for="stat in weapon.subStat" :key="`sub-${stat.propertyId}`" class="ik-zzz-weapon__stat">
          <span class="ik-zzz-weapon__stat-name">{{ stat.name }}</span>
          <span class="ik-zzz-weapon__stat-value">{{ stat.displayValue }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ik-zzz-weapon {
  padding: 12px 0;
}

.ik-zzz-weapon__empty {
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
}

.ik-zzz-weapon__main {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.25);
  margin-bottom: 12px;
}

.ik-zzz-weapon__icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
}

.ik-zzz-weapon__info {
  flex: 1;
  min-width: 0;
}

.ik-zzz-weapon__name {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
}

.ik-zzz-weapon__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
}

.ik-zzz-weapon__rarity {
  color: #fbfe00;
  font-weight: 700;
}

.ik-zzz-weapon__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.ik-zzz-weapon__stat {
  flex: 1 1 45%;
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 13px;
}

.ik-zzz-weapon__stat-name {
  color: rgba(255, 255, 255, 0.6);
}

.ik-zzz-weapon__stat-value {
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
</style>
