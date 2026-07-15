<script setup lang="ts">
import { BENEFIT_MAX_LEVEL, BENEFIT_MATRIX } from "~/utils/benefits";
import { LEVEL_TITLES } from "~/utils/level";

const auth = useAuthStore();
const loginDialog = useLoginDialog();

// -- Auth guard --
if (import.meta.client && !auth.isLogin) {
  loginDialog.open();
  navigateTo("/");
}

const {
  level,
  nextLevel,
  nextBenefits,
  articleMaxImages,
  commentMaxImages,
  articleMaxBody,
} = useBenefits();

const levelTitle = computed(() =>
  level.value > 0 ? LEVEL_TITLES[level.value] ?? "" : "待通过入站考试",
);

const formatNum = (n: number) => n.toLocaleString("zh-CN");

const highlightCards = computed(() => [
  {
    key: "articleMaxImages",
    name: "发帖图片",
    unit: "张",
    icon: "image",
    value: articleMaxImages.value,
    next: nextBenefits.value?.articleMaxImages ?? null,
  },
  {
    key: "commentMaxImages",
    name: "评论图片",
    unit: "张",
    icon: "comment",
    value: commentMaxImages.value,
    next: nextBenefits.value?.commentMaxImages ?? null,
  },
  {
    key: "articleMaxBody",
    name: "正文字数",
    unit: "字",
    icon: "text",
    value: articleMaxBody.value,
    next: nextBenefits.value?.articleMaxBody ?? null,
  },
]);

// -- 全等级权益一览（Lv.1 起；Lv.0 未通过考试单独说明） --
const matrixRows = Array.from({ length: BENEFIT_MAX_LEVEL }, (_, i) => {
  const lv = i + 1;
  return {
    level: lv,
    title: LEVEL_TITLES[lv] ?? "",
    articleMaxImages: BENEFIT_MATRIX.articleMaxImages[lv]!,
    commentMaxImages: BENEFIT_MATRIX.commentMaxImages[lv]!,
    articleMaxBody: BENEFIT_MATRIX.articleMaxBody[lv]!,
  };
});

useHead({ title: "权益中心" });
</script>

<template>
  <div class="ik-bf">
    <div class="ik-bf__stripe" aria-hidden="true"></div>
    <div class="ik-bf__container">

      <!-- Hero -->
      <section class="ik-bf__hero">
        <div class="ik-bf__hero-main">
          <h1 class="ik-bf__title">权益中心</h1>
          <p class="ik-bf__hero-hint">等级越高，创作空间越大</p>
        </div>
        <div class="ik-bf__level-badge">
          <span class="ik-bf__level-num">Lv.{{ level }}</span>
          <span class="ik-bf__level-title">{{ levelTitle }}</span>
        </div>
      </section>

      <!-- Current benefits -->
      <section class="ik-bf__cards">
        <div
          v-for="card in highlightCards"
          :key="card.key"
          class="ik-bf__card"
        >
          <div class="ik-bf__card-icon" aria-hidden="true">
            <svg v-if="card.icon === 'image'" width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6" />
              <circle cx="9" cy="10" r="1.8" fill="currentColor" />
              <path d="M4.5 18.5L10 13l4 4 3-3 2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg v-else-if="card.icon === 'comment'" width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M21 12a8 8 0 0 1-8 8H4.6a.6.6 0 0 1-.42-1.02L6 17.16A8 8 0 1 1 21 12Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <circle cx="9" cy="12" r="1.1" fill="currentColor" />
              <circle cx="13" cy="12" r="1.1" fill="currentColor" />
              <circle cx="17" cy="12" r="1.1" fill="currentColor" />
            </svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M5 5h14M12 5v14M8 19h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <span class="ik-bf__card-name">{{ card.name }}</span>
          <span class="ik-bf__card-value">
            {{ formatNum(card.value) }}<em class="ik-bf__card-unit">{{ card.unit }}</em>
          </span>
          <span v-if="nextLevel != null && card.next != null" class="ik-bf__card-next">
            Lv.{{ nextLevel }} → {{ formatNum(card.next) }} {{ card.unit }}
          </span>
          <span v-else class="ik-bf__card-next ik-bf__card-next--max">已达最高档</span>
        </div>
      </section>

      <!-- Benefits matrix -->
      <section class="ik-bf__card-block">
        <div class="ik-bf__block-header">
          <h2 class="ik-bf__block-title">全等级权益一览</h2>
        </div>
        <div class="ik-bf__table">
          <div class="ik-bf__table-head">
            <span class="ik-bf__col ik-bf__col--level">等级</span>
            <span class="ik-bf__col">发帖图片</span>
            <span class="ik-bf__col">评论图片</span>
            <span class="ik-bf__col">正文字数</span>
          </div>
          <div
            v-for="row in matrixRows"
            :key="row.level"
            class="ik-bf__table-row"
            :class="{ 'is-current': row.level === level }"
          >
            <span class="ik-bf__col ik-bf__col--level">
              <span class="ik-bf__row-num">Lv.{{ row.level }}</span>
              <span class="ik-bf__row-title">{{ row.title }}</span>
            </span>
            <span class="ik-bf__col ik-bf__col--num">{{ row.articleMaxImages }} 张</span>
            <span class="ik-bf__col ik-bf__col--num">{{ row.commentMaxImages }} 张</span>
            <span class="ik-bf__col ik-bf__col--num">{{ formatNum(row.articleMaxBody) }} 字</span>
          </div>
        </div>
        <div class="ik-bf__notes">
          <p class="ik-bf__note">· 单张图片大小上限 10MB，全等级一致</p>
          <p class="ik-bf__note">· 未通过入站考试（Lv.0）暂无法发布委托与评论</p>
          <p class="ik-bf__note">· 已发布的内容不受等级调整影响，仅在新建 / 编辑时生效</p>
        </div>
      </section>

      <!-- Upgrade CTA -->
      <NuxtLink to="/level" class="ik-bf__cta">
        <span class="ik-bf__cta-text">获取绳网信用，提升等级</span>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M7.5 5l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </NuxtLink>

    </div>
  </div>
</template>

<style scoped>
/* ── Page container（与绳网等级页一致的视觉体系） ── */
.ik-bf {
  position: relative;
  width: 100%;
  min-height: 100vh;
  padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px));
}

.ik-bf__stripe {
  position: fixed;
  inset: 0;
  z-index: 0;
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

.ik-bf__container {
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Hero ── */
.ik-bf__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0 12px;
}

.ik-bf__hero-main {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ik-bf__title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.ik-bf__level-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.ik-bf__level-num {
  font-size: 16px;
  font-weight: 800;
  background: linear-gradient(135deg, #4661fd, #10bff0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ik-bf__level-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
}

.ik-bf__hero-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── 当前权益三卡 ── */
.ik-bf__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.ik-bf__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 10px 16px;
  background: rgba(18, 18, 20, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.ik-bf__card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: #10bff0;
  background: rgba(70, 97, 253, 0.12);
}

.ik-bf__card-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
}

.ik-bf__card-value {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
  line-height: 1.1;
}

.ik-bf__card-unit {
  margin-left: 2px;
  font-size: 12px;
  font-weight: 600;
  font-style: normal;
  color: rgba(255, 255, 255, 0.4);
}

.ik-bf__card-next {
  font-size: 11px;
  font-weight: 600;
  color: rgba(191, 255, 9, 0.75);
  padding: 2px 8px;
  background: rgba(191, 255, 9, 0.08);
  border-radius: 999px;
  white-space: nowrap;
}

.ik-bf__card-next--max {
  color: rgba(251, 254, 0, 0.6);
  background: rgba(251, 254, 0, 0.06);
}

/* ── 权益一览卡片 ── */
.ik-bf__card-block {
  background: rgba(18, 18, 20, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.ik-bf__block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
}

.ik-bf__block-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.2px;
}

.ik-bf__table {
  padding: 12px 20px 4px;
}

.ik-bf__table-head,
.ik-bf__table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 8px;
}

.ik-bf__table-head {
  padding: 6px 0 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-bf__table-head .ik-bf__col {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  text-align: right;
}

.ik-bf__table-head .ik-bf__col--level {
  text-align: left;
}

.ik-bf__table-row {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.2s;
}

.ik-bf__table-row:last-child {
  border-bottom: none;
}

.ik-bf__table-row.is-current {
  background: rgba(70, 97, 253, 0.08);
  margin: 0 -20px;
  padding: 12px 20px;
  border-radius: 12px;
  border-bottom-color: transparent;
}

.ik-bf__col--level {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ik-bf__row-num {
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  min-width: 36px;
}

.ik-bf__table-row.is-current .ik-bf__row-num {
  background: linear-gradient(135deg, #4661fd, #10bff0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ik-bf__row-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-bf__table-row.is-current .ik-bf__row-title {
  color: rgba(255, 255, 255, 0.8);
}

.ik-bf__col--num {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.ik-bf__table-row.is-current .ik-bf__col--num {
  color: #fff;
}

.ik-bf__notes {
  padding: 8px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ik-bf__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.25);
}

/* ── 升级 CTA ── */
.ik-bf__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4661fd 0%, #10bff0 100%);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 8px 24px rgba(16, 91, 240, 0.25);
  -webkit-tap-highlight-color: transparent;
}

.ik-bf__cta:hover {
  box-shadow: 0 10px 28px rgba(16, 91, 240, 0.4);
}

.ik-bf__cta:active {
  transform: scale(0.97);
}

/* ── Mobile ── */
@media (max-width: 420px) {
  .ik-bf__cards {
    gap: 8px;
  }
  .ik-bf__card-value {
    font-size: 20px;
  }
  .ik-bf__row-title {
    display: none;
  }
}

/* ── Desktop ── */
@media (min-width: 900px) {
  .ik-bf {
    padding-top: 48px;
    padding-bottom: 80px;
  }

  .ik-bf__container {
    max-width: 960px;
    gap: 20px;
  }

  /* 横向 hero：标题居左，等级徽章居右 */
  .ik-bf__hero {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 4px 4px;
  }

  .ik-bf__title {
    font-size: 32px;
  }

  .ik-bf__hero-hint {
    margin: 6px 0 0;
    font-size: 14px;
  }

  .ik-bf__hero-main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .ik-bf__level-badge {
    margin-top: 0;
    padding: 10px 18px;
    background: rgba(18, 18, 20, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
  }

  .ik-bf__level-num {
    font-size: 22px;
  }

  .ik-bf__level-title {
    font-size: 15px;
    color: rgba(255, 255, 255, 0.6);
  }

  .ik-bf__cards {
    gap: 16px;
  }

  .ik-bf__card {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 22px 24px;
    transition: border-color 0.2s ease, transform 0.2s ease;
  }

  .ik-bf__card:hover {
    border-color: rgba(70, 97, 253, 0.45);
    transform: translateY(-2px);
  }

  .ik-bf__card-icon {
    width: 46px;
    height: 46px;
    border-radius: 14px;
  }

  .ik-bf__card-name {
    flex: 1;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.55);
  }

  .ik-bf__card-value {
    width: 100%;
    order: 3;
    font-size: 32px;
    margin-top: 10px;
  }

  .ik-bf__card-next {
    order: 4;
    font-size: 12px;
  }

  .ik-bf__block-header {
    padding: 24px 28px 0;
  }

  .ik-bf__block-title {
    font-size: 19px;
  }

  .ik-bf__table {
    padding: 14px 28px 6px;
  }

  .ik-bf__table-head .ik-bf__col {
    font-size: 12px;
  }

  .ik-bf__table-row {
    padding: 14px 0;
  }

  .ik-bf__table-row.is-current {
    margin: 0 -28px;
    padding: 14px 28px;
  }

  .ik-bf__row-num {
    font-size: 15px;
    min-width: 44px;
  }

  .ik-bf__row-title {
    font-size: 13px;
  }

  .ik-bf__col--num {
    font-size: 14px;
  }

  .ik-bf__notes {
    padding: 10px 28px 20px;
  }

  .ik-bf__cta {
    align-self: center;
    width: 320px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-bf__cta { transition: none; }
  .ik-bf__table-row { transition: none; }
}
</style>
