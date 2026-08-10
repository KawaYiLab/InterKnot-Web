<script setup lang="ts">
import type { ZzzPanelProperty } from "~/types/entities";

defineProps<{
  properties: ZzzPanelProperty[];
}>();

const weightClassLabel: Record<string, string> = {
  great: "核心",
  good: "有效",
  useful: "可用",
  useless: "无效",
};
</script>

<template>
  <div class="ik-zzz-properties">
    <div
      v-for="prop in properties"
      :key="prop.propertyId"
      class="ik-zzz-properties__row"
      :class="`is-${prop.weightClass}`"
    >
      <div class="ik-zzz-properties__name">
        {{ prop.name }}
        <span v-if="prop.weightClass !== 'useless'" class="ik-zzz-properties__weight">{{ weightClassLabel[prop.weightClass] }}</span>
      </div>
      <div class="ik-zzz-properties__values">
        <span class="ik-zzz-properties__base">{{ prop.baseDisplay }}</span>
        <span class="ik-zzz-properties__add">{{ prop.addDisplay }}</span>
        <span class="ik-zzz-properties__final">{{ prop.finalDisplay }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-zzz-properties {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
}

.ik-zzz-properties__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.ik-zzz-properties__row.is-great { border-left: 3px solid #fbfe00; }
.ik-zzz-properties__row.is-good { border-left: 3px solid #4661fd; }
.ik-zzz-properties__row.is-useful { border-left: 3px solid rgba(255,255,255,0.25); }
.ik-zzz-properties__row.is-useless { border-left: 3px solid rgba(255,255,255,0.08); opacity: 0.6; }

.ik-zzz-properties__name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-zzz-properties__weight {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.55);
}

.ik-zzz-properties__values {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ik-zzz-properties__base {
  color: rgba(255, 255, 255, 0.45);
  min-width: 64px;
  text-align: right;
}

.ik-zzz-properties__add {
  color: #10bff0;
  min-width: 64px;
  text-align: right;
}

.ik-zzz-properties__final {
  color: #fff;
  min-width: 64px;
  text-align: right;
}
</style>
