<script setup lang="ts">
import type { ZzzPanelDamage as ZzzDamage } from "~/types/entities";

const props = defineProps<{
  damage: ZzzDamage;
}>();

const areas = computed(() => {
  const list = Object.entries(props.damage.details?.areas || {})
    .sort((a, b) => b[1] - a[1]);
  return list;
});

const formatNumber = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return Math.round(n).toLocaleString("zh-CN");
};
</script>

<template>
  <div class="ik-zzz-damage">
    <div class="ik-zzz-damage__summary">
      <div class="ik-zzz-damage__card">
        <span class="ik-zzz-damage__label">伤害指数</span>
        <span class="ik-zzz-damage__big">{{ formatNumber(damage.damageIndex) }}</span>
      </div>
      <div v-if="damage.details?.selectedSkill" class="ik-zzz-damage__card">
        <span class="ik-zzz-damage__label">参考技能</span>
        <span class="ik-zzz-damage__skill">{{ damage.details.selectedSkill.name }}</span>
        <span class="ik-zzz-damage__skill-type">{{ damage.details.selectedSkill.type }}</span>
      </div>
    </div>

    <h3 class="ik-zzz-damage__title">技能期望伤害</h3>
    <div class="ik-zzz-damage__skills">
      <div
        v-for="skill in damage.details?.skills || []"
        :key="skill.type"
        class="ik-zzz-damage__skill-row"
      >
        <span class="ik-zzz-damage__skill-name">{{ skill.name }}</span>
        <span class="ik-zzz-damage__skill-crit">暴击 {{ formatNumber(skill.critDMG) }}</span>
        <span class="ik-zzz-damage__skill-expect">期望 {{ formatNumber(skill.expectDMG) }}</span>
      </div>
    </div>

    <h3 class="ik-zzz-damage__title">乘区分布</h3>
    <div class="ik-zzz-damage__areas">
      <div
        v-for="[name, value] in areas"
        :key="name"
        class="ik-zzz-damage__area"
      >
        <span class="ik-zzz-damage__area-name">{{ name }}</span>
        <div class="ik-zzz-damage__area-bar">
          <div
            class="ik-zzz-damage__area-fill"
            :style="{ width: `${Math.min(Math.max(value * 100, 0), 100)}%` }"
          ></div>
        </div>
        <span class="ik-zzz-damage__area-value">{{ value.toFixed(2) }}</span>
      </div>
    </div>

    <h3 class="ik-zzz-damage__title">生效增益</h3>
    <div class="ik-zzz-damage__buffs">
      <div
        v-for="(buff, index) in damage.details?.buffs || []"
        :key="`buff-${index}`"
        class="ik-zzz-damage__buff"
      >
        <span class="ik-zzz-damage__buff-name">{{ buff.name }}</span>
        <span class="ik-zzz-damage__buff-source">{{ buff.source || buff.type }}</span>
        <span class="ik-zzz-damage__buff-value">+{{ buff.value }}</span>
      </div>
    </div>

    <h3 class="ik-zzz-damage__title">面板增益</h3>
    <div class="ik-zzz-damage__buffs">
      <div
        v-for="(buff, index) in damage.details?.panelBuffs || []"
        :key="`panel-${index}`"
        class="ik-zzz-damage__buff"
      >
        <span class="ik-zzz-damage__buff-name">{{ buff.name }}</span>
        <span class="ik-zzz-damage__buff-value">{{ buff.value }}<template v-if="buff.max"> / {{ buff.max }}</template></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-zzz-damage {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ik-zzz-damage__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.ik-zzz-damage__card {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  padding: 14px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.25);
  gap: 4px;
}

.ik-zzz-damage__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.ik-zzz-damage__big {
  font-size: 32px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.ik-zzz-damage__skill {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.ik-zzz-damage__skill-type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-zzz-damage__title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.ik-zzz-damage__skills {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-zzz-damage__skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 13px;
}

.ik-zzz-damage__skill-name {
  color: #fff;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-zzz-damage__skill-crit {
  color: #ff9e80;
  font-weight: 700;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
}

.ik-zzz-damage__skill-expect {
  color: #10bff0;
  font-weight: 700;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
}

.ik-zzz-damage__areas {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-zzz-damage__area {
  display: grid;
  grid-template-columns: 100px 1fr 64px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.ik-zzz-damage__area-name {
  color: rgba(255, 255, 255, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-zzz-damage__area-bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.ik-zzz-damage__area-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4661fd, #10bff0);
  transition: width 0.4s ease;
}

.ik-zzz-damage__area-value {
  color: #fff;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.ik-zzz-damage__buffs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.ik-zzz-damage__buff {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
}

.ik-zzz-damage__buff-name {
  color: #fff;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-zzz-damage__buff-source {
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}

.ik-zzz-damage__buff-value {
  color: #c2ff80;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
