<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";
import type { AccountSecurity, BlockedUser, MihoyoBinding } from "~/types/entities";

const auth = useAuthStore();
const api = useApi();
const message = useMessage();
const loginDialog = useLoginDialog();

// -- Auth guard --
if (import.meta.client && !auth.isLogin) {
  loginDialog.open();
  navigateTo("/");
}

// ── 页面视图 ─────────────────────────────────
type AccountView = "" | "email" | "password" | "mihoyo" | "blacklist";
const activeView = ref<AccountView>("");

const sidebarActive = computed(() => {
  if (!activeView.value) return "account";
  if (activeView.value === "email" || activeView.value === "password") return "account";
  return activeView.value;
});

// ── 米游社绑定 ─────────────────────────────
const mihoyoBinding = ref<MihoyoBinding | null>(null);
const mihoyoLoading = ref(true);
const mihoyoLoaded = ref(false);
const mihoyoUnbinding = ref(false);

const mihoyo = useMihoyoQr({
  isActive: () => activeView.value === "mihoyo" && !mihoyoBinding.value,
  width: 200,
  onConfirmed: (res) => {
    if (res.mode !== "bind") return;
    mihoyoBinding.value = res.binding;
    message.success("米游社账号绑定成功");
  },
  onError: (err) => {
    message.error(resolveErrorMessage(err, "获取二维码失败"));
  },
});

const mihoyoQrDataUrl = mihoyo.qrDataUrl;
const mihoyoQrStatus = mihoyo.qrStatus;
const mihoyoQrNeedRefresh = mihoyo.qrNeedRefresh;
const startMihoyoQr = mihoyo.startQr;
const stopMihoyoQr = mihoyo.stopQr;

const mihoyoQrStatusText = computed(() => {
  switch (mihoyoQrStatus.value) {
    case "loading": return "二维码生成中…";
    case "waiting": return "请使用米游社 App 扫码绑定";
    case "scanned": return "已扫码，请在米游社 App 中确认";
    case "confirmed": return "绑定中…";
    case "expired": return "二维码已过期，点击刷新";
    case "cancelled": return "已取消扫码，点击刷新重试";
    case "error": return "二维码获取失败，点击刷新重试";
  }
});

const loadMihoyo = async () => {
  mihoyoLoading.value = true;
  try {
    mihoyoBinding.value = await api.getMihoyoBinding();
    mihoyoLoaded.value = true;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取绑定信息失败"));
  } finally {
    mihoyoLoading.value = false;
  }
  if (!mihoyoBinding.value && activeView.value === "mihoyo") {
    void startMihoyoQr();
  }
};

const openMihoyo = async () => {
  activeView.value = "mihoyo";
  if (!mihoyoLoaded.value) {
    await loadMihoyo();
  } else if (!mihoyoBinding.value) {
    void startMihoyoQr();
  }
};

const unbindMihoyo = async () => {
  if (mihoyoUnbinding.value) return;
  mihoyoUnbinding.value = true;
  try {
    await api.unbindMihoyo();
    mihoyoBinding.value = null;
    message.success("已解除米游社绑定");
    void startMihoyoQr();
  } catch (err) {
    message.error(resolveErrorMessage(err, "解绑失败"));
  } finally {
    mihoyoUnbinding.value = false;
  }
};

// ── 账号安全 ─────────────────────────────────
const MIHOYO_PLACEHOLDER_EMAIL_SUFFIX = "@mihoyo-login.inter-knot.invalid";

const security = ref<AccountSecurity | null>(null);
const securityLoading = ref(false);

const bindEmailInput = ref("");
const bindCodeInput = ref("");
const bindEmailLoading = ref(false);

const setPasswordCodeInput = ref("");
const setPasswordInput = ref("");
const setPasswordConfirmInput = ref("");
const setPasswordLoading = ref(false);

const codeCooldown = ref(0);
let codeCooldownTimer: ReturnType<typeof setInterval> | null = null;

const startCodeCooldown = (seconds: number) => {
  codeCooldown.value = seconds;
  codeCooldownTimer = setInterval(() => {
    codeCooldown.value -= 1;
    if (codeCooldown.value <= 0 && codeCooldownTimer) {
      clearInterval(codeCooldownTimer);
      codeCooldownTimer = null;
    }
  }, 1000);
};

onBeforeUnmount(() => {
  if (codeCooldownTimer) {
    clearInterval(codeCooldownTimer);
    codeCooldownTimer = null;
  }
});

const loadSecurity = async () => {
  if (!auth.isLogin) return;
  securityLoading.value = true;
  try {
    security.value = await api.getMySecurity();
  } catch {
    // 后端 /api/me/security 尚未部署时的降级：根据 auth.user.email 推断
    const email = auth.user?.email || "";
    const isPlaceholder = email.endsWith(MIHOYO_PLACEHOLDER_EMAIL_SUFFIX);
    security.value = {
      email,
      provider: isPlaceholder ? "mihoyo" : "local",
      hasBoundEmail: !!email && !isPlaceholder,
      hasPassword: !!email && !isPlaceholder,
    };
  } finally {
    securityLoading.value = false;
  }
};

const logout = () => {
  auth.clearSession();
  void navigateTo("/");
};

const openEmail = () => {
  activeView.value = "email";
  bindEmailInput.value = security.value?.email || "";
  bindCodeInput.value = "";
};

const openPassword = () => {
  activeView.value = "password";
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
};

const goBack = () => {
  stopMihoyoQr();
  activeView.value = "";
  bindEmailInput.value = "";
  bindCodeInput.value = "";
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const sendBindEmailCode = async () => {
  const email = bindEmailInput.value.trim();
  if (!isValidEmail(email)) {
    message.warning("请输入正确的邮箱");
    return;
  }
  bindEmailLoading.value = true;
  try {
    const res = await api.sendBindEmailCode(email);
    message.success("验证码已发送");
    startCodeCooldown(res.cooldown || 60);
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送验证码失败"));
  } finally {
    bindEmailLoading.value = false;
  }
};

const confirmBindEmail = async () => {
  const email = bindEmailInput.value.trim();
  const code = bindCodeInput.value.trim();
  if (!isValidEmail(email) || !code) {
    message.warning("请填写正确的邮箱和验证码");
    return;
  }
  bindEmailLoading.value = true;
  try {
    const res = await api.bindEmail(email, code);
    security.value = res;
    auth.updateUserPartial({ email });
    message.success("邮箱绑定成功");
    goBack();
  } catch (err) {
    message.error(resolveErrorMessage(err, "绑定邮箱失败"));
  } finally {
    bindEmailLoading.value = false;
  }
};

const sendSetPasswordCode = async () => {
  if (!security.value?.hasBoundEmail || !security.value.email) {
    message.warning("请先绑定邮箱");
    return;
  }
  setPasswordLoading.value = true;
  try {
    const res = await api.sendResetCode(security.value.email);
    message.success("验证码已发送");
    startCodeCooldown(res.cooldown || 60);
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送验证码失败"));
  } finally {
    setPasswordLoading.value = false;
  }
};

const confirmSetPassword = async () => {
  const code = setPasswordCodeInput.value.trim();
  const password = setPasswordInput.value;
  const confirm = setPasswordConfirmInput.value;
  if (!code || !password) {
    message.warning("请填写验证码和新密码");
    return;
  }
  if (password.length < 6) {
    message.warning("密码长度不能少于 6 位");
    return;
  }
  if (password !== confirm) {
    message.warning("两次输入的密码不一致");
    return;
  }
  if (!security.value?.hasBoundEmail || !security.value.email) {
    message.warning("请先绑定邮箱");
    return;
  }
  setPasswordLoading.value = true;
  try {
    await api.resetPassword(security.value.email, code, password);
    if (security.value) {
      security.value.hasPassword = true;
      security.value.provider = "local";
    }
    message.success(security.value?.hasPassword ? "密码修改成功" : "密码设置成功");
    goBack();
  } catch (err) {
    message.error(resolveErrorMessage(err, "设置密码失败"));
  } finally {
    setPasswordLoading.value = false;
  }
};

// ── 黑名单管理 ─────────────────────────────
const blockedUsers = ref<BlockedUser[]>([]);
const blockedLoading = ref(false);
const blockedHasNext = ref(true);
const blockedCursor = ref("");
const blockedLoaded = ref(false);

const blockedCountText = computed(() => {
  if (blockedLoading.value) return "加载中";
  if (!blockedLoaded.value) return "管理屏蔽的用户";
  const count = blockedUsers.value.length;
  const suffix = blockedHasNext.value ? "+" : "";
  return count ? `${count}${suffix} 个用户` : "0 个用户";
});

const loadBlocked = async () => {
  if (blockedLoading.value || !blockedHasNext.value) return;
  blockedLoading.value = true;
  try {
    const page = await api.getMyBlockedList(blockedCursor.value);
    blockedUsers.value.push(...page.nodes);
    blockedHasNext.value = page.hasNextPage;
    blockedCursor.value = page.endCursor;
  } catch (err) {
    message.error(resolveErrorMessage(err, "加载黑名单失败"));
  } finally {
    blockedLoading.value = false;
    blockedLoaded.value = true;
  }
};

const openBlacklist = () => {
  activeView.value = "blacklist";
  if (!blockedLoaded.value) void loadBlocked();
};

const unblockUser = async (user: BlockedUser) => {
  if (!user.documentId) return;
  try {
    await api.toggleUserBlock(user.documentId);
    message.success("已取消拉黑");
    blockedUsers.value = blockedUsers.value.filter(
      (u) => u.documentId !== user.documentId,
    );
    api.invalidateQueries(["articles"]);
    api.invalidateQueries(["profile"]);
  } catch (err) {
    message.error(resolveErrorMessage(err, "取消拉黑失败"));
  }
};

onMounted(() => {
  if (!auth.isLogin) return;
  void loadSecurity();
  void loadMihoyo();
  void loadBlocked();
});

useHead({ title: "账号中心", bodyAttrs: { class: "ik-account-page" } });
</script>

<template>
  <div class="ik-ac" :class="{ 'ik-ac--detail': !!activeView }">
    <div class="ik-ac__container">
      <header class="ik-ac__header">
        <h1 class="ik-ac__title">账号中心</h1>
        <p class="ik-ac__subtitle-en">ACCOUNT CENTER</p>
        <div class="ik-ac__header-divider" />
        <p class="ik-ac__subtitle">管理你的 InterKnot 身份、安全与连接</p>
      </header>

      <aside class="ik-ac__sidebar">
        <div class="ik-ac__nav-group">
          <h3 class="ik-ac__nav-title">设置</h3>
          <nav class="ik-ac__nav">
            <button
              class="ik-ac__nav-item"
              :class="{ 'is-active': sidebarActive === 'account' }"
              @click="activeView = ''"
            >
              账号
            </button>
            <button
              class="ik-ac__nav-item"
              :class="{ 'is-active': sidebarActive === 'mihoyo' }"
              @click="openMihoyo"
            >
              连接
            </button>
            <button
              class="ik-ac__nav-item"
              :class="{ 'is-active': sidebarActive === 'blacklist' }"
              @click="openBlacklist"
            >
              隐私
            </button>
          </nav>
        </div>
        <div class="ik-ac__nav-group">
          <h3 class="ik-ac__nav-title ik-ac__nav-title--danger">危险操作</h3>
          <button class="ik-ac__nav-item ik-ac__nav-item--danger" @click="logout">
            退出登录
          </button>
        </div>
      </aside>

      <main class="ik-ac__content">
        <!-- 概览（移动端列表 / 桌面端账号概览） -->
        <div v-if="!activeView" class="ik-ac__overview">
          <!-- 移动端列表 -->
          <div class="ik-ac__overview-mobile">
            <section class="ik-ac__group">
              <h2 class="ik-ac__group-title">账号</h2>
              <button class="ik-ac__row" @click="openEmail">
                <span class="ik-ac__row-label">邮箱</span>
                <span
                  class="ik-ac__row-value"
                  :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                </span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
              <button class="ik-ac__row" @click="openPassword">
                <span class="ik-ac__row-label">密码</span>
                <span
                  class="ik-ac__row-value"
                  :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                </span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </section>

            <section class="ik-ac__group">
              <h2 class="ik-ac__group-title">连接</h2>
              <button class="ik-ac__row" @click="openMihoyo">
                <span class="ik-ac__row-label">米哈游账号</span>
                <span
                  class="ik-ac__row-value"
                  :class="{ 'is-empty': !mihoyoBinding && !mihoyoLoading }"
                >
                  {{ mihoyoLoading ? '加载中' : mihoyoBinding ? (mihoyoBinding.zzzNickname || '已绑定') : '未绑定' }}
                </span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </section>

            <section class="ik-ac__group">
              <h2 class="ik-ac__group-title">隐私</h2>
              <button class="ik-ac__row" @click="openBlacklist">
                <span class="ik-ac__row-label">黑名单</span>
                <span class="ik-ac__row-value">{{ blockedCountText }}</span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </section>

            <section class="ik-ac__group">
              <h2 class="ik-ac__group-title">危险操作</h2>
              <button class="ik-ac__row ik-ac__row--danger" @click="logout">
                <span class="ik-ac__row-label">退出登录</span>
              </button>
            </section>
          </div>

          <!-- 桌面端账号概览 -->
          <div class="ik-ac__overview-desktop">
            <section class="ik-ac__section">
              <h3 class="ik-ac__section-title">账号</h3>
              <div class="ik-ac__section-divider" />
              <button class="ik-ac__row" @click="openEmail">
                <span class="ik-ac__row-label">邮箱</span>
                <span
                  class="ik-ac__row-value"
                  :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                </span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
              <button class="ik-ac__row" @click="openPassword">
                <span class="ik-ac__row-label">密码</span>
                <span
                  class="ik-ac__row-value"
                  :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                </span>
                <span class="ik-ac__row-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </section>
          </div>
        </div>

        <!-- 邮箱详情 -->
        <div v-else-if="activeView === 'email'" class="ik-ac__detail">
          <header class="ik-ac__detail-header">
            <button class="ik-ac__back" aria-label="返回" @click="goBack">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 class="ik-ac__detail-title">邮箱</h2>
            <div class="ik-ac__detail-spacer" />
          </header>

          <div class="ik-ac__detail-body">
            <template v-if="securityLoading">
              <p class="ik-ac__loading">加载中…</p>
            </template>
            <template v-else>
              <z-input
                v-model="bindEmailInput"
                type="email"
                placeholder="请输入邮箱"
              />
              <div class="ik-ac__security-code">
                <z-input v-model="bindCodeInput" placeholder="请输入验证码" />
                <button
                  class="ik-ac__btn ik-ac__btn--small"
                  :disabled="codeCooldown > 0 || bindEmailLoading"
                  @click="sendBindEmailCode"
                >
                  {{ bindEmailLoading ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码' }}
                </button>
              </div>
              <button
                class="ik-ac__btn"
                :disabled="bindEmailLoading"
                @click="confirmBindEmail"
              >
                {{ security?.hasBoundEmail ? '修改邮箱' : '绑定邮箱' }}
              </button>
            </template>
          </div>
        </div>

        <!-- 密码详情 -->
        <div v-else-if="activeView === 'password'" class="ik-ac__detail">
          <header class="ik-ac__detail-header">
            <button class="ik-ac__back" aria-label="返回" @click="goBack">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 class="ik-ac__detail-title">密码</h2>
            <div class="ik-ac__detail-spacer" />
          </header>

          <div class="ik-ac__detail-body">
            <template v-if="securityLoading">
              <p class="ik-ac__loading">加载中…</p>
            </template>
            <template v-else-if="!security?.hasBoundEmail">
              <p class="ik-ac__empty">请先绑定邮箱后再设置密码。</p>
              <button class="ik-ac__btn ik-ac__btn--ghost" @click="goBack">返回</button>
            </template>
            <template v-else>
              <p class="ik-ac__security-send-hint">
                验证码将发送至 {{ security.email }}
              </p>
              <div class="ik-ac__security-code">
                <z-input v-model="setPasswordCodeInput" placeholder="请输入验证码" />
                <button
                  class="ik-ac__btn ik-ac__btn--small"
                  :disabled="codeCooldown > 0 || setPasswordLoading"
                  @click="sendSetPasswordCode"
                >
                  {{ setPasswordLoading ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码' }}
                </button>
              </div>
              <z-input
                v-model="setPasswordInput"
                type="password"
                placeholder="新密码（至少 6 位）"
              />
              <z-input
                v-model="setPasswordConfirmInput"
                type="password"
                placeholder="确认新密码"
              />
              <button
                class="ik-ac__btn"
                :disabled="setPasswordLoading"
                @click="confirmSetPassword"
              >
                {{ security?.hasPassword ? '修改密码' : '设置密码' }}
              </button>
            </template>
          </div>
        </div>

        <!-- 米游社详情 -->
        <div v-else-if="activeView === 'mihoyo'" class="ik-ac__detail">
          <header class="ik-ac__detail-header">
            <button class="ik-ac__back" aria-label="返回" @click="goBack">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 class="ik-ac__detail-title">米哈游账号</h2>
            <div class="ik-ac__detail-spacer" />
          </header>

          <div class="ik-ac__detail-body">
            <template v-if="mihoyoLoading">
              <p class="ik-ac__loading">加载中…</p>
            </template>

            <template v-else-if="mihoyoBinding">
              <div class="ik-ac__mihoyo-info">
                <div class="ik-ac__mihoyo-row">
                  <span class="ik-ac__mihoyo-label">名称</span>
                  <span class="ik-ac__mihoyo-value">{{ mihoyoBinding.zzzNickname || "未获取到角色" }}</span>
                </div>
                <div v-if="mihoyoBinding.zzzUid" class="ik-ac__mihoyo-row">
                  <span class="ik-ac__mihoyo-label">UID</span>
                  <span class="ik-ac__mihoyo-value">{{ mihoyoBinding.zzzUid }}</span>
                </div>
                <div v-if="mihoyoBinding.zzzLevel != null" class="ik-ac__mihoyo-row">
                  <span class="ik-ac__mihoyo-label">等级</span>
                  <span class="ik-ac__mihoyo-value">Lv.{{ mihoyoBinding.zzzLevel }}</span>
                </div>
                <div v-if="mihoyoBinding.zzzRegionName" class="ik-ac__mihoyo-row">
                  <span class="ik-ac__mihoyo-label">服务器</span>
                  <span class="ik-ac__mihoyo-value">{{ mihoyoBinding.zzzRegionName }}</span>
                </div>
              </div>
              <button
                class="ik-ac__btn ik-ac__btn--danger"
                :disabled="mihoyoUnbinding"
                @click="unbindMihoyo"
              >
                {{ mihoyoUnbinding ? "解绑中…" : "解除绑定" }}
              </button>
            </template>

            <template v-else>
              <p class="ik-ac__security-send-hint">请使用米游社 App 扫码绑定</p>
              <div class="ik-ac__qr-box" :class="{ 'is-dimmed': mihoyoQrNeedRefresh }">
                <img
                  v-if="mihoyoQrDataUrl"
                  :src="mihoyoQrDataUrl"
                  alt="米游社绑定二维码"
                  class="ik-ac__qr"
                  draggable="false"
                />
                <div v-else class="ik-ac__qr-placeholder" />
                <button
                  v-if="mihoyoQrNeedRefresh"
                  type="button"
                  class="ik-ac__qr-refresh"
                  @click="startMihoyoQr"
                >
                  刷新二维码
                </button>
              </div>
              <p class="ik-ac__qr-status" :class="`is-${mihoyoQrStatus}`">
                {{ mihoyoQrStatusText }}
              </p>
            </template>
          </div>
        </div>

        <!-- 黑名单详情 -->
        <div v-else-if="activeView === 'blacklist'" class="ik-ac__detail">
          <header class="ik-ac__detail-header">
            <button class="ik-ac__back" aria-label="返回" @click="goBack">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 class="ik-ac__detail-title">黑名单</h2>
            <div class="ik-ac__detail-spacer" />
          </header>

          <div class="ik-ac__detail-body">
            <template v-if="!blockedUsers.length && blockedLoaded && !blockedLoading">
              <div class="ik-ac__empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
                  <path d="M5.8 5.8l12.4 12.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <span>暂无拉黑用户</span>
              </div>
            </template>

            <div v-if="blockedUsers.length" class="ik-ac__blocked-list">
              <div
                v-for="user in blockedUsers"
                :key="user.documentId"
                class="ik-ac__blocked-item"
              >
                <img
                  :src="user.avatar || '/images/default-avatar.webp'"
                  alt=""
                  class="ik-ac__blocked-avatar"
                  @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                />
                <div class="ik-ac__blocked-info">
                  <span class="ik-ac__blocked-name">{{ user.name || user.username || '匿名用户' }}</span>
                  <span v-if="user.level" class="ik-ac__blocked-level">Lv.{{ user.level }}</span>
                </div>
                <button class="ik-ac__btn ik-ac__btn--small" @click="unblockUser(user)">
                  取消拉黑
                </button>
              </div>
            </div>

            <p v-if="blockedLoading" class="ik-ac__loading">加载中…</p>
            <button
              v-else-if="blockedHasNext && blockedUsers.length"
              class="ik-ac__btn ik-ac__btn--ghost"
              @click="loadBlocked"
            >
              加载更多
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* ── Page ── */
.ik-ac {
  width: 100%;
  min-height: 100vh;
  padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px));
}

.ik-ac__container {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas:
    "header"
    "content";
  gap: 24px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  align-items: start;
}

.ik-ac__header {
  grid-area: header;
  padding: 24px 0 8px;
}

.ik-ac__title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #fff;
}

.ik-ac__subtitle {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

.ik-ac__subtitle-en {
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.ik-ac__header-divider {
  height: 1px;
  margin: 16px 0 12px;
  background: rgba(255, 255, 255, 0.08);
}

.ik-ac__sidebar {
  display: none;
  grid-area: sidebar;
  flex-direction: column;
  gap: 32px;
  height: fit-content;
}

.ik-ac__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ik-ac__nav-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-ac__nav-title {
  margin: 0;
  padding: 0 14px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.35);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ik-ac__nav-title--danger {
  color: rgba(255, 107, 107, 0.65);
}

.ik-ac__nav-item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px 14px 10px 28px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.ik-ac__nav-item::before {
  content: "○";
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 10px;
  line-height: 12px;
  text-align: center;
}

.ik-ac__nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.ik-ac__nav-item.is-active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.ik-ac__nav-item.is-active::before {
  content: "●";
  color: #bfff09;
}

.ik-ac__nav-item--danger {
  padding-left: 14px;
  color: #ff6b6b;
}

.ik-ac__nav-item--danger::before {
  content: none;
}

.ik-ac__nav-item--danger:hover {
  background: rgba(255, 107, 107, 0.08);
}

.ik-ac__content {
  grid-area: content;
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

/* ── Overview ── */
.ik-ac__overview {
  display: contents;
}

.ik-ac__overview-mobile {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.ik-ac__overview-desktop {
  display: none;
  flex-direction: column;
  gap: 32px;
}

/* ── Mobile grouped list ── */
.ik-ac__group {
  display: flex;
  flex-direction: column;
}

.ik-ac__group-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.35);
  letter-spacing: 0.5px;
}

/* ── Rows ── */
.ik-ac__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 15px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.ik-ac__row:last-child {
  border-bottom: none;
}

.ik-ac__row:hover {
  opacity: 0.85;
}

.ik-ac__row-label {
  flex-shrink: 0;
}

.ik-ac__row-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-ac__row-value.is-empty {
  color: rgba(255, 255, 255, 0.25);
}

.ik-ac__row-chevron {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.25);
}

.ik-ac__row-chevron svg {
  display: block;
  width: 16px;
  height: 16px;
}

.ik-ac__row--danger {
  justify-content: center;
  color: #ff6b6b;
  border-bottom: none;
}

/* ── Desktop section ── */
.ik-ac__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ik-ac__section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.ik-ac__section-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

/* ── Detail view ── */
.ik-ac__detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 16px;
}

.ik-ac__detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-ac__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  transition: background 0.12s ease;
}

.ik-ac__back:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ik-ac__back svg {
  width: 18px;
  height: 18px;
}

.ik-ac__detail-title {
  flex: 1;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  text-align: center;
}

.ik-ac__detail-spacer {
  width: 36px;
}

.ik-ac__detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-ac__detail-body :deep(.z-input) {
  width: 100%;
}

/* ── 账号安全表单 ── */
.ik-ac__security-code {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-ac__security-code :deep(.z-input) {
  flex: 1;
}

.ik-ac__security-send-hint {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
}

/* ── 米游社绑定 ── */
.ik-ac__mihoyo-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.ik-ac__mihoyo-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.ik-ac__mihoyo-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.ik-ac__mihoyo-value {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  text-align: right;
  word-break: break-all;
}

.ik-ac__qr-box {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.ik-ac__qr {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-ac__qr-box.is-dimmed .ik-ac__qr {
  filter: blur(3px) brightness(0.5);
}

.ik-ac__qr-placeholder {
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
}

.ik-ac__qr-refresh {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #bfff09;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}

.ik-ac__qr-status {
  margin: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.ik-ac__qr-status.is-scanned,
.ik-ac__qr-status.is-confirmed {
  color: #bfff09;
}

.ik-ac__qr-status.is-expired,
.ik-ac__qr-status.is-cancelled,
.ik-ac__qr-status.is-error {
  color: #ff6b6b;
}

/* ── 黑名单 ── */
.ik-ac__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
}

.ik-ac__blocked-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.ik-ac__blocked-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.ik-ac__blocked-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
}

.ik-ac__blocked-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ik-ac__blocked-name {
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-ac__blocked-level {
  color: #bfff09;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

/* ── Buttons ── */
.ik-ac__btn {
  border: none;
  border-radius: 12px;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  background: linear-gradient(135deg, #4661fd 0%, #10bff0 100%);
  color: #fff;
  -webkit-tap-highlight-color: transparent;
  text-align: center;
}

.ik-ac__btn:active:not(:disabled) {
  transform: scale(0.96);
}

.ik-ac__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ik-ac__btn--danger {
  background: rgba(255, 82, 82, 0.12);
  color: #ff6b6b;
}

.ik-ac__btn--small {
  padding: 7px 14px;
  font-size: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  flex-shrink: 0;
}

.ik-ac__btn--ghost {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
}

/* ── Misc ── */
.ik-ac__loading {
  margin: 0;
  padding: 12px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  text-align: center;
}

/* ── Desktop ── */
@media (min-width: 900px) {
  .ik-ac {
    padding-top: 48px;
    padding-bottom: 80px;
  }

  .ik-ac__container {
    grid-template-columns: 260px 1fr;
    grid-template-areas:
      "header header"
      "sidebar content";
    gap: 48px;
    padding: 0 40px;
  }

  .ik-ac__sidebar {
    display: flex;
    position: sticky;
    top: 48px;
  }

  .ik-ac__header {
    padding: 12px 0 0;
  }

  .ik-ac__title {
    font-size: 26px;
  }

  .ik-ac__overview-mobile {
    display: none;
  }

  .ik-ac__overview-desktop {
    display: flex;
  }

  .ik-ac__content {
    gap: 32px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 24px;
  }

  .ik-ac__detail {
    padding-top: 0;
  }

  .ik-ac__detail-body {
    gap: 18px;
  }
}

@media (max-width: 899px) {
  .ik-ac--detail .ik-ac__header {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-ac__btn,
  .ik-ac__row,
  .ik-ac__nav-item {
    transition: none;
  }
}
</style>

<style>
/* 账号中心：全局跑马灯背景保持极低且均匀的透明度 */
.ik-account-page .ik-zzz-marquee {
  opacity: 0.05;
}
</style>
