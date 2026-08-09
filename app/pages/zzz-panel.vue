<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";
import type { ZzzPanel } from "~/types/entities";

const auth = useAuthStore();
const api = useApi();
const route = useRoute();
const message = useMessage();
const loginDialog = useLoginDialog();

const uid = computed(() => (route.query.uid as string | undefined) || undefined);
const avatarId = computed(() => {
  const raw = route.query.avatarId;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
});

const panel = ref<ZzzPanel | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const fetchPanel = async () => {
  loading.value = true;
  error.value = null;
  try {
    if (uid.value) {
      panel.value = await api.getZzzPanel(uid.value, avatarId.value);
    } else if (auth.isLogin) {
      panel.value = await api.getMyZzzPanel(avatarId.value);
    } else {
      loginDialog.open();
      return;
    }
  } catch (err) {
    error.value = resolveErrorMessage(err, "获取面板失败");
    message.error(error.value);
  } finally {
    loading.value = false;
  }
};

watch([uid, avatarId], fetchPanel, { immediate: true });

const avatarElementText = (element?: string) => {
  const map: Record<string, string> = {
    fire: "火",
    ice: "冰",
    electric: "电",
    physical: "物理",
    ether: "以太",
  };
  return map[element || ""] || element || "未知";
};

const professionText = (profession?: string) => {
  const map: Record<string, string> = {
    Attack: "强攻",
    Stun: "击破",
    Anomaly: "异常",
    Support: "支援",
    Defense: "防护",
    Rupture: "命破",
  };
  return map[profession || ""] || profession || "未知";
};

const scorePercent = computed(() => {
  if (!panel.value) return 0;
  return Math.round((panel.value.avatar.score.total / panel.value.avatar.score.max) * 1000) / 10;
});
</script>

<template>
  <div class="zzz-panel-page">
    <div class="zzz-panel-card">
      <h1 class="zzz-panel-title">绝区零角色面板</h1>

      <div v-if="loading" class="zzz-panel-empty">加载中…</div>
      <div v-else-if="error" class="zzz-panel-error">{{ error }}</div>
      <div v-else-if="!panel" class="zzz-panel-empty">暂无面板数据</div>

      <div v-else class="zzz-panel-body">
        <div class="zzz-panel-header">
          <div>
            <div class="zzz-panel-name">{{ panel.avatar.name }}</div>
            <div class="zzz-panel-meta">
              Lv.{{ panel.avatar.level }} · {{ professionText(panel.avatar.profession) }} · {{ avatarElementText(panel.avatar.element) }}
            </div>
            <div class="zzz-panel-uid">UID: {{ panel.uid }}</div>
          </div>
          <div class="zzz-panel-badges">
            <div class="zzz-panel-badge">
              <div class="zzz-panel-badge-label">驱动盘评分</div>
              <div class="zzz-panel-badge-value">{{ panel.avatar.score.total }}</div>
              <div class="zzz-panel-badge-sublabel">/ {{ panel.avatar.score.max }} ({{ scorePercent }}%)</div>
            </div>
            <div class="zzz-panel-badge">
              <div class="zzz-panel-badge-label">伤害指数</div>
              <div class="zzz-panel-badge-value zzz-panel-badge-primary">{{ Math.round(panel.avatar.damage.damageIndex) }}</div>
            </div>
          </div>
        </div>

        <div class="zzz-panel-stats">
          <div v-for="stat in [
            { label: '攻击力', value: Math.round(panel.avatar.damage.finalAtk) },
            { label: '生命值', value: Math.round(panel.avatar.damage.finalHp) },
            { label: '防御力', value: Math.round(panel.avatar.damage.finalDef) },
            { label: '冲击力', value: Math.round(panel.avatar.damage.impact) },
            { label: '暴击率', value: (panel.avatar.damage.critRate * 100).toFixed(1) + '%' },
            { label: '暴击伤害', value: (panel.avatar.damage.critDmg * 100).toFixed(1) + '%' },
            { label: '异常精通', value: Math.round(panel.avatar.damage.anomalyProficiency) },
            { label: '异常掌控', value: Math.round(panel.avatar.damage.anomalyControl) },
          ]" :key="stat.label" class="zzz-panel-stat">
            <div class="zzz-panel-stat-label">{{ stat.label }}</div>
            <div class="zzz-panel-stat-value">{{ stat.value }}</div>
          </div>
        </div>

        <div class="zzz-panel-section">
          <h2 class="zzz-panel-section-title">驱动盘</h2>
          <div class="zzz-panel-discs">
            <div v-for="disc in panel.avatar.discs" :key="disc.slot" class="zzz-panel-disc">
              <div class="zzz-panel-disc-header">
                <span>{{ disc.slot }} 号位</span>
                <span class="zzz-panel-disc-level">+{{ disc.level }}</span>
              </div>
              <div class="zzz-panel-disc-main">
                {{ disc.mainStat[0]?.meta?.displayName }}: {{ disc.mainStat[0]?.displayValue }}
              </div>
              <div class="zzz-panel-disc-subs">
                <div v-for="(sub, idx) in disc.subStats" :key="idx" class="zzz-panel-disc-sub">
                  <span>{{ sub.meta?.displayName }} {{ sub.PropertyLevel }}</span>
                  <span>{{ sub.displayValue }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.zzz-panel-page {
  min-height: 100vh;
  padding: 16px;
  background: var(--ik-bg);
}

@media (min-width: 768px) {
  .zzz-panel-page {
    padding: 32px;
  }
}

.zzz-panel-card {
  max-width: 1024px;
  margin: 0 auto;
  padding: 24px;
  border: 1px solid #333;
  border-radius: 24px;
  background: var(--ik-bg-card);
  color: var(--ik-text);
}

.zzz-panel-title {
  margin: 0 0 24px;
  font-size: 22px;
  font-weight: 700;
}

.zzz-panel-empty,
.zzz-panel-error {
  padding: 48px 0;
  text-align: center;
  color: var(--ik-muted);
}

.zzz-panel-error {
  color: var(--ik-danger);
}

.zzz-panel-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 24px;
}

@media (min-width: 768px) {
  .zzz-panel-header {
    flex-direction: row;
    align-items: center;
  }
}

.zzz-panel-name {
  font-size: 28px;
  font-weight: 700;
}

.zzz-panel-meta,
.zzz-panel-uid {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ik-muted);
}

.zzz-panel-badges {
  display: flex;
  gap: 12px;
}

.zzz-panel-badge {
  min-width: 110px;
  padding: 12px 16px;
  border-radius: 16px;
  text-align: center;
  background: var(--ik-bg-elevated);
}

.zzz-panel-badge-label {
  font-size: 12px;
  color: var(--ik-muted);
}

.zzz-panel-badge-value {
  margin: 4px 0;
  font-size: 20px;
  font-weight: 700;
}

.zzz-panel-badge-primary {
  color: var(--ik-primary);
}

.zzz-panel-badge-sublabel {
  font-size: 11px;
  color: var(--ik-muted);
}

.zzz-panel-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

@media (min-width: 768px) {
  .zzz-panel-stats {
    grid-template-columns: repeat(4, 1fr);
  }
}

.zzz-panel-stat {
  padding: 12px;
  border-radius: 12px;
  background: var(--ik-bg-elevated);
}

.zzz-panel-stat-label {
  font-size: 12px;
  color: var(--ik-muted);
}

.zzz-panel-stat-value {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 600;
}

.zzz-panel-section-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
}

.zzz-panel-discs {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 12px;
}

@media (min-width: 768px) {
  .zzz-panel-discs {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .zzz-panel-discs {
    grid-template-columns: repeat(3, 1fr);
  }
}

.zzz-panel-disc {
  padding: 16px;
  border: 1px solid #333;
  border-radius: 16px;
  background: var(--ik-bg-elevated);
}

.zzz-panel-disc-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
}

.zzz-panel-disc-level {
  font-size: 12px;
  color: var(--ik-muted);
}

.zzz-panel-disc-main {
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--ik-primary);
}

.zzz-panel-disc-sub {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 12px;
  color: var(--ik-muted);
}
</style>
