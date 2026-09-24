<script setup lang="ts">
import type { ZzzPanelDisc } from "~/types/entities";

defineProps<{
  discs: ZzzPanelDisc[];
}>();

const slotLabel = (slot: number) => `${slot} 号位`;
</script>

<template>
  <div class="ik-zzz-discs">
    <div
      v-for="disc in discs"
      :key="disc.slot"
      class="ik-zzz-discs__item"
    >
      <div class="ik-zzz-discs__header">
        <div class="ik-zzz-discs__suit">
          <img
            v-if="disc.suitIconUrl"
            :src="disc.suitIconUrl"
            alt=""
            class="ik-zzz-discs__suit-icon"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <span class="ik-zzz-discs__suit-name">{{ disc.suitName || '未知套装' }}</span>
        </div>
        <div class="ik-zzz-discs__score">
          <span class="ik-zzz-discs__slot">{{ slotLabel(disc.slot) }}</span>
          <span class="ik-zzz-discs__score-value">{{ Math.round(disc.score) }}</span>
          <span class="ik-zzz-discs__comment">{{ disc.comment }}</span>
        </div>
      </div>
      <div class="ik-zzz-discs__level">+{{ disc.level }}</div>
      <div class="ik-zzz-discs__stats">
        <div
          v-for="stat in disc.mainStats"
          :key="`main-${stat.propertyId}`"
          class="ik-zzz-discs__stat is-main"
        >
          <span>{{ stat.name }}</span>
          <span>{{ stat.displayValue }}</span>
        </div>
        <div
          v-for="stat in disc.subStats"
          :key="`sub-${stat.propertyId}`"
          class="ik-zzz-discs__stat"
        >
          <span>{{ stat.name }}</span>
          <span>{{ stat.displayValue }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-zzz-discs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  padding: 12px 0;
}

.ik-zzz-discs__item {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ik-zzz-discs__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.ik-zzz-discs__suit {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ik-zzz-discs__suit-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.ik-zzz-discs__suit-name {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-zzz-discs__score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.ik-zzz-discs__slot {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.ik-zzz-discs__score-value {
  font-size: 20px;
  font-weight: 800;
  color: #fbfe00;
  line-height: 1;
}

.ik-zzz-discs__comment {
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.5);
}

.ik-zzz-discs__level {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-zzz-discs__stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-zzz-discs__stat {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.ik-zzz-discs__stat.is-main {
  color: #10bff0;
  font-weight: 700;
}

.ik-zzz-discs__stat span:first-child {
  color: rgba(255, 255, 255, 0.65);
}

.ik-zzz-discs__stat span:last-child {
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
</style>
