<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
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
type AccountMenuKey = "account" | "mihoyo" | "blacklist";
type AccountSubView = "" | "email" | "password";
const activeMenuKey = ref<AccountMenuKey>("account");
const activeSubView = ref<AccountSubView>("");

// 移动端：首屏改为单栏分组列表，点击后进入对应二级面板
const isMobile = useMediaQuery("(max-width: 900px)");
const atRoot = computed(
  () => activeMenuKey.value === "account" && activeSubView.value === "",
);

const onMenuChange = (name: string | number) => {
  const key = String(name) as AccountMenuKey;
  activeMenuKey.value = key;
  activeSubView.value = "";
  if (key === "mihoyo") {
    if (!mihoyoLoaded.value) {
      void loadMihoyo();
    } else if (!mihoyoBinding.value) {
      void startMihoyoQr();
    }
  } else if (key === "blacklist" && !blockedLoaded.value) {
    void loadBlocked();
  }
};

// ── 米游社绑定 ─────────────────────────────
const mihoyoBinding = ref<MihoyoBinding | null>(null);
const mihoyoLoading = ref(true);
const mihoyoLoaded = ref(false);
const mihoyoUnbinding = ref(false);

const mihoyo = useMihoyoQr({
  isActive: () => activeMenuKey.value === "mihoyo" && !mihoyoBinding.value,
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

const mihoyoMetaText = computed(() => {
  if (mihoyoLoading.value) return "加载中";
  return mihoyoBinding.value ? (mihoyoBinding.value.zzzNickname || "已绑定") : "未绑定";
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
  if (!mihoyoBinding.value && activeMenuKey.value === "mihoyo") {
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
  if (codeCooldownTimer) {
    clearInterval(codeCooldownTimer);
    codeCooldownTimer = null;
  }
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

const accountMetaText = computed(() => {
  if (securityLoading.value) return "加载中";
  if (security.value?.hasBoundEmail) return security.value.email;
  if (security.value?.hasPassword) return "已设置密码";
  return "未绑定邮箱";
});

const openEmail = () => {
  activeSubView.value = "email";
  bindEmailInput.value = security.value?.email || "";
  bindCodeInput.value = "";
};

const openPassword = () => {
  activeSubView.value = "password";
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
};

const goBack = () => {
  stopMihoyoQr();
  activeMenuKey.value = "account";
  activeSubView.value = "";
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

const clearBindEmailForm = () => {
  bindEmailInput.value = "";
  bindCodeInput.value = "";
};

const clearSetPasswordForm = () => {
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
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
    const hadPassword = security.value?.hasPassword === true;
    if (security.value) {
      security.value.hasPassword = true;
      security.value.provider = "local";
    }
    message.success(hadPassword ? "密码修改成功" : "密码设置成功");
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

const blacklistMetaText = computed(() => {
  if (blockedLoading.value) return "加载中";
  if (!blockedLoaded.value) return "管理屏蔽的用户";
  return blockedUsers.value.length ? `${blockedUsers.value.length} 个用户` : "0 个用户";
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

useHead({ title: "账号中心" });
</script>

<template>
  <section class="ik-account-page">
    <div class="ik-account-page__stripe" aria-hidden="true"></div>

    <div class="ik-account-page__columns">
      <aside v-if="!isMobile" class="ik-account-page__nav">
        <z-menu class="ik-account-menu" :model-value="activeMenuKey" @change="onMenuChange">
          <z-menu-item name="account" icon="home">
            <div class="ik-account-menu__content">
              <span class="ik-account-menu__title">账号</span>
              <span class="ik-account-menu__meta">{{ accountMetaText }}</span>
            </div>
          </z-menu-item>

          <z-menu-item name="mihoyo" icon="plus">
            <div class="ik-account-menu__content">
              <span class="ik-account-menu__title">连接</span>
              <span class="ik-account-menu__meta">{{ mihoyoMetaText }}</span>
            </div>
          </z-menu-item>

          <z-menu-item name="blacklist" icon="error">
            <div class="ik-account-menu__content">
              <span class="ik-account-menu__title">黑名单</span>
              <span class="ik-account-menu__meta">{{ blacklistMetaText }}</span>
            </div>
          </z-menu-item>
        </z-menu>
      </aside>

      <div class="ik-account-page__panel">
        <div class="ik-account-page__panel-body">
          <!-- 移动端首屏：单栏分组列表 -->
          <template v-if="isMobile && atRoot">
            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">账号</span>
              </div>
              <button class="ik-ac-row" @click="openEmail">
                <span class="ik-ac-row__label">
                  <i class="z-icon-info" aria-hidden="true" />
                  邮箱
                </span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
              <button class="ik-ac-row" @click="openPassword">
                <span class="ik-ac-row__label">
                  <i class="z-icon-invisible" aria-hidden="true" />
                  密码
                </span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </div>

            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">连接</span>
              </div>
              <button class="ik-ac-row" @click="onMenuChange('mihoyo')">
                <span class="ik-ac-row__label">米哈游账号</span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !mihoyoBinding && !mihoyoLoading }"
                >
                  {{ mihoyoMetaText }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </div>

            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">黑名单</span>
              </div>
              <button class="ik-ac-row" @click="onMenuChange('blacklist')">
                <span class="ik-ac-row__label">黑名单</span>
                <span class="ik-ac-row__value">{{ blacklistMetaText }}</span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </div>
          </template>

          <!-- 账号 -->
          <template v-else-if="activeMenuKey === 'account'">
            <template v-if="activeSubView === ''">
              <div class="ik-ac-section">
                <div class="ik-ac-section__head">
                  <span class="ik-ac-section__label">账号</span>
                </div>

                <button class="ik-ac-row" @click="openEmail">
                  <span class="ik-ac-row__label">
                    <i class="z-icon-info" aria-hidden="true" />
                    邮箱
                  </span>
                  <span
                    class="ik-ac-row__value"
                    :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                  >
                    {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                  </span>
                  <span class="ik-ac-row__chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                </button>

                <button class="ik-ac-row" @click="openPassword">
                  <span class="ik-ac-row__label">
                    <i class="z-icon-invisible" aria-hidden="true" />
                    密码
                  </span>
                  <span
                    class="ik-ac-row__value"
                    :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                  >
                    {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                  </span>
                  <span class="ik-ac-row__chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                </button>
              </div>
            </template>

            <template v-else-if="activeSubView === 'email'">
              <header class="ik-ac-detail-header">
                <button class="ik-ac-back" aria-label="返回" @click="goBack">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <h2 class="ik-ac-detail-title">邮箱</h2>
                <div class="ik-ac-detail-spacer" />
              </header>

              <div class="ik-ac-detail-body">
                <template v-if="securityLoading">
                  <p class="ik-ac-loading">加载中…</p>
                </template>
                <template v-else>
                  <z-form class="ik-ac-form" label-position="top">
                    <z-form-item label="邮箱">
                      <z-input
                        v-model="bindEmailInput"
                        type="email"
                        placeholder="请输入邮箱"
                      />
                    </z-form-item>
                    <z-form-item label="验证码">
                      <z-input v-model="bindCodeInput" placeholder="请输入验证码">
                        <template #append>
                          <z-button
                            class="ik-ac-code-btn"
                            :disabled="codeCooldown > 0 || bindEmailLoading"
                            @click="sendBindEmailCode"
                          >
                            {{ bindEmailLoading ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送' }}
                          </z-button>
                        </template>
                      </z-input>
                    </z-form-item>
                  </z-form>
                  <div class="ik-ac-form-actions">
                    <z-button
                      :icon="{ error: '#ff4444' }"
                      :disabled="bindEmailLoading"
                      @click="clearBindEmailForm"
                    >
                      清除
                    </z-button>
                    <z-button
                      :icon="{ success: '#00cc0d' }"
                      :disabled="bindEmailLoading || !bindEmailInput.trim() || !bindCodeInput.trim()"
                      @click="confirmBindEmail"
                    >
                      确认
                    </z-button>
                  </div>
                </template>
              </div>
            </template>

            <template v-else-if="activeSubView === 'password'">
              <header class="ik-ac-detail-header">
                <button class="ik-ac-back" aria-label="返回" @click="goBack">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <h2 class="ik-ac-detail-title">密码</h2>
                <div class="ik-ac-detail-spacer" />
              </header>

              <div class="ik-ac-detail-body">
                <template v-if="securityLoading">
                  <p class="ik-ac-loading">加载中…</p>
                </template>
                <template v-else-if="!security?.hasBoundEmail">
                  <p class="ik-ac-empty">请先绑定邮箱后再设置密码。</p>
                  <button class="ik-ac-btn ik-ac-btn--ghost" @click="goBack">返回</button>
                </template>
                <template v-else>
                  <p class="ik-ac-security-send-hint">
                    验证码将发送至 {{ security.email }}
                  </p>
                  <z-form class="ik-ac-form" label-position="top">
                    <z-form-item label="新密码">
                      <z-input
                        v-model="setPasswordInput"
                        type="password"
                        placeholder="新密码（至少 6 位）"
                      />
                    </z-form-item>
                    <z-form-item label="确认密码">
                      <z-input
                        v-model="setPasswordConfirmInput"
                        type="password"
                        placeholder="确认新密码"
                      />
                    </z-form-item>
                    <z-form-item label="验证码">
                      <z-input v-model="setPasswordCodeInput" placeholder="请输入验证码">
                        <template #append>
                          <z-button
                            class="ik-ac-code-btn"
                            :disabled="codeCooldown > 0 || setPasswordLoading"
                            @click="sendSetPasswordCode"
                          >
                            {{ setPasswordLoading ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送' }}
                          </z-button>
                        </template>
                      </z-input>
                    </z-form-item>
                  </z-form>
                  <div class="ik-ac-form-actions">
                    <z-button
                      :icon="{ error: '#ff4444' }"
                      :disabled="setPasswordLoading"
                      @click="clearSetPasswordForm"
                    >
                      清除
                    </z-button>
                    <z-button
                      :icon="{ success: '#00cc0d' }"
                      :disabled="setPasswordLoading || !setPasswordCodeInput.trim() || !setPasswordInput || !setPasswordConfirmInput"
                      @click="confirmSetPassword"
                    >
                      确认
                    </z-button>
                  </div>
                </template>
              </div>
            </template>
          </template>

          <!-- 连接 / 米游社 -->
          <template v-else-if="activeMenuKey === 'mihoyo'">
            <header class="ik-ac-detail-header">
              <button v-if="isMobile" class="ik-ac-back" aria-label="返回" @click="goBack">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h2 class="ik-ac-detail-title">米哈游账号</h2>
              <div v-if="isMobile" class="ik-ac-detail-spacer" />
            </header>

            <div class="ik-ac-detail-body">
              <template v-if="mihoyoLoading">
                <p class="ik-ac-loading">加载中…</p>
              </template>

              <template v-else-if="mihoyoBinding">
                <div class="ik-ac-mihoyo-info">
                  <div class="ik-ac-mihoyo-row">
                    <span class="ik-ac-mihoyo-label">名称</span>
                    <span class="ik-ac-mihoyo-value">{{ mihoyoBinding.zzzNickname || "未获取到角色" }}</span>
                  </div>
                  <div v-if="mihoyoBinding.zzzUid" class="ik-ac-mihoyo-row">
                    <span class="ik-ac-mihoyo-label">UID</span>
                    <span class="ik-ac-mihoyo-value">{{ mihoyoBinding.zzzUid }}</span>
                  </div>
                  <div v-if="mihoyoBinding.zzzLevel != null" class="ik-ac-mihoyo-row">
                    <span class="ik-ac-mihoyo-label">等级</span>
                    <span class="ik-ac-mihoyo-value">Lv.{{ mihoyoBinding.zzzLevel }}</span>
                  </div>
                  <div v-if="mihoyoBinding.zzzRegionName" class="ik-ac-mihoyo-row">
                    <span class="ik-ac-mihoyo-label">服务器</span>
                    <span class="ik-ac-mihoyo-value">{{ mihoyoBinding.zzzRegionName }}</span>
                  </div>
                </div>
                <button
                  class="ik-ac-btn ik-ac-btn--danger"
                  :disabled="mihoyoUnbinding"
                  @click="unbindMihoyo"
                >
                  {{ mihoyoUnbinding ? "解绑中…" : "解除绑定" }}
                </button>
              </template>

              <template v-else>
                <p class="ik-ac-security-send-hint">请使用米游社 App 扫码绑定</p>
                <div class="ik-ac-qr-box" :class="{ 'is-dimmed': mihoyoQrNeedRefresh }">
                  <img
                    v-if="mihoyoQrDataUrl"
                    :src="mihoyoQrDataUrl"
                    alt="米游社绑定二维码"
                    class="ik-ac-qr"
                    draggable="false"
                  />
                  <div v-else class="ik-ac-qr-placeholder" />
                  <button
                    v-if="mihoyoQrNeedRefresh"
                    type="button"
                    class="ik-ac-qr-refresh"
                    @click="startMihoyoQr"
                  >
                    刷新二维码
                  </button>
                </div>
                <p class="ik-ac-qr-status" :class="`is-${mihoyoQrStatus}`">
                  {{ mihoyoQrStatusText }}
                </p>
              </template>
            </div>
          </template>

          <!-- 隐私 / 黑名单 -->
          <template v-else-if="activeMenuKey === 'blacklist'">
            <header class="ik-ac-detail-header">
              <button v-if="isMobile" class="ik-ac-back" aria-label="返回" @click="goBack">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h2 class="ik-ac-detail-title">黑名单</h2>
              <div v-if="isMobile" class="ik-ac-detail-spacer" />
            </header>

            <div class="ik-ac-detail-body">
              <template v-if="!blockedUsers.length && blockedLoaded && !blockedLoading">
                <div class="ik-ac-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
                    <path d="M5.8 5.8l12.4 12.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  <span>暂无拉黑用户</span>
                </div>
              </template>

              <div v-if="blockedUsers.length" class="ik-ac-blocked-list">
                <div
                  v-for="user in blockedUsers"
                  :key="user.documentId"
                  class="ik-ac-blocked-item"
                >
                  <img
                    :src="user.avatar || '/images/default-avatar.webp'"
                    alt=""
                    class="ik-ac-blocked-avatar"
                    @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                  />
                  <div class="ik-ac-blocked-info">
                    <span class="ik-ac-blocked-name">{{ user.name || user.username || '匿名用户' }}</span>
                    <span v-if="user.level" class="ik-ac-blocked-level">Lv.{{ user.level }}</span>
                  </div>
                  <button class="ik-ac-btn ik-ac-btn--small" @click="unblockUser(user)">
                    取消拉黑
                  </button>
                </div>
              </div>

              <p v-if="blockedLoading" class="ik-ac-loading">加载中…</p>
              <button
                v-else-if="blockedHasNext && blockedUsers.length"
                class="ik-ac-btn ik-ac-btn--ghost"
                @click="loadBlocked"
              >
                加载更多
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Account Center – mirrors /create two-column layout
   ═══════════════════════════════════════════════ */
.ik-account-page {
  position: relative;
  width: min(1440px, calc(100% - 40px));
  margin: 0 auto;
  padding: 60px 0;
  min-height: calc(100vh - 78px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
}

/* 45° 斜线纹理（与发布委托页一致） */
.ik-account-page__stripe {
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

.ik-account-page__columns {
  position: relative;
  z-index: 1;
  flex: 1;
  display: grid;
  grid-template-columns: 230px 1fr;
  gap: 16px;
  min-height: 0;
  align-items: stretch;
}

/* ═════════ Left Nav ═════════ */
.ik-account-page__nav {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 100px);
}

.ik-account-menu {
  flex: 1;
  min-height: 320px !important;
  max-height: 100%;
}

/* Customize ZMenu items */
.ik-account-menu :deep(.z-menu__item) {
  align-items: center;
  min-height: 56px;
  padding: 10px 16px;
}

.ik-account-menu__content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  width: 100%;
}

.ik-account-menu__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.2px;
}


.ik-account-menu__meta {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.ik-account-menu :deep(.z-menu__item.is-active) .ik-account-menu__title,
.ik-account-menu :deep(.z-menu__item.is-active) .z-menu__icon {
  color: #0a0a0a;
}

.ik-account-menu :deep(.z-menu__item.is-active) .ik-account-menu__meta {
  color: rgba(0, 0, 0, 0.6);
  opacity: 1;
}

/* ═════════ Right Panel ═════════ */
.ik-account-page__panel {
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
  min-height: 320px;
}

.ik-account-page__panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 22px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #0a0a0a 0%, #070707 100%);
  border: 4px solid #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
}

/* ── Section rows ── */
.ik-ac-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-ac-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}

.ik-ac-section__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #bbb;
  letter-spacing: 0.4px;
}

.ik-ac-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid #1f1f1f;
  color: #fff;
  font-size: 15px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.ik-ac-row:last-child {
  border-bottom: none;
}

.ik-ac-row:hover {
  opacity: 0.85;
}

.ik-ac-row__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ik-ac-row__label i {
  font-size: 16px;
  color: #888;
}

.ik-ac-row__value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 14px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-ac-row__value.is-empty {
  color: #555;
}

.ik-ac-row__chevron {
  flex-shrink: 0;
  color: #555;
}

.ik-ac-row__chevron svg {
  display: block;
  width: 16px;
  height: 16px;
}

/* ── Detail view ── */
.ik-ac-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-ac-back {
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

.ik-ac-back:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ik-ac-back svg {
  width: 18px;
  height: 18px;
}

.ik-ac-detail-title {
  flex: 1;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  text-align: center;
}

.ik-ac-detail-spacer {
  width: 36px;
}

.ik-ac-detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-ac-detail-body :deep(.z-input) {
  width: 100%;
}

/* ── 账号安全表单 ── */
.ik-ac-form {
  display: flex;
  flex-direction: column;
}

.ik-ac-form :deep(.z-form-item) {
  margin-bottom: 0;
}

.ik-ac-form :deep(.z-form-item + .z-form-item) {
  margin-top: 16px;
}

.ik-ac-form :deep(.z-form-item__label) {
  color: #b8b8c0;
  text-align: left;
  padding-right: 0;
  line-height: 1.4;
  margin-bottom: 6px;
}

.ik-ac-form :deep(.z-input) {
  width: 100%;
}

.ik-ac-form :deep(.z-input__append) {
  display: flex;
}

.ik-ac-code-btn {
  white-space: nowrap;
}

.ik-ac-form-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.ik-ac-security-send-hint {
  margin: 0;
  font-size: 13px;
  color: #888;
  text-align: center;
}

/* ── 米游社绑定 ── */
.ik-ac-mihoyo-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.ik-ac-mihoyo-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.ik-ac-mihoyo-label {
  font-size: 13px;
  color: #888;
  flex-shrink: 0;
}

.ik-ac-mihoyo-value {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  text-align: right;
  word-break: break-all;
}

.ik-ac-qr-box {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.ik-ac-qr {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-ac-qr-box.is-dimmed .ik-ac-qr {
  filter: blur(3px) brightness(0.5);
}

.ik-ac-qr-placeholder {
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
}

.ik-ac-qr-refresh {
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

.ik-ac-qr-status {
  margin: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.ik-ac-qr-status.is-scanned,
.ik-ac-qr-status.is-confirmed {
  color: #bfff09;
}

.ik-ac-qr-status.is-expired,
.ik-ac-qr-status.is-cancelled,
.ik-ac-qr-status.is-error {
  color: #ff6b6b;
}

/* ── 黑名单 ── */
.ik-ac-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: #555;
  font-size: 13px;
}

.ik-ac-blocked-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.ik-ac-blocked-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.ik-ac-blocked-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
}

.ik-ac-blocked-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ik-ac-blocked-name {
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-ac-blocked-level {
  color: #bfff09;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

/* ── Buttons ── */
.ik-ac-btn {
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

.ik-ac-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.ik-ac-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ik-ac-btn--danger {
  background: rgba(255, 82, 82, 0.12);
  color: #ff6b6b;
}

.ik-ac-btn--small {
  padding: 7px 14px;
  font-size: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  flex-shrink: 0;
}

.ik-ac-btn--ghost {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
}

/* ── Misc ── */
.ik-ac-loading {
  margin: 0;
  padding: 12px 0;
  font-size: 13px;
  color: #555;
  text-align: center;
}

/* ═══════════════════════════════════════════════
   Responsive
   ═══════════════════════════════════════════════ */
@media (max-width: 1200px) {
  .ik-account-page__columns {
    grid-template-columns: 200px 1fr;
  }
}

@media (max-width: 900px) {
  .ik-account-page {
    width: calc(100% - 24px);
    padding: 48px 0 96px;
    min-height: calc(100vh - 66px - 64px);
    gap: 12px;
  }

  /* 移动端：单栏，左侧导航不渲染，面板内直接展示分组列表 */
  .ik-account-page__columns {
    grid-template-columns: 1fr;
  }

  .ik-account-page__panel {
    min-height: 280px;
  }

  .ik-account-page__panel-body {
    padding: 18px 18px 22px;
    gap: 12px;
  }
}

@media (max-width: 500px) {
  .ik-account-page {
    width: 100%;
    padding: 32px 0 90px;
    min-height: calc(100vh - 66px - 64px);
    gap: 0;
  }

  .ik-account-page__columns {
    padding: 0 12px;
    gap: 12px;
  }

  .ik-account-page__panel {
    border-radius: 14px;
  }

  .ik-account-page__panel-body {
    padding: 14px 14px 18px;
    border-radius: 12px;
    border-width: 2px;
  }
}

@media (min-width: 901px) {
  .ik-account-page__columns {
    align-self: center;
    width: 100%;
    max-width: 1000px;
    grid-template-columns: 220px minmax(0, 720px);
    justify-content: center;
    gap: 16px;
  }

  .ik-account-page__panel {
    width: 100%;
  }

  .ik-account-page__panel-body {
    align-items: center;
  }

  .ik-account-page__panel-body > * {
    width: 100%;
    max-width: 640px;
  }

  /* 桌面端：账号安全表单输入框、按钮等收窄并居中，避免横屏过度拉伸 */
  .ik-ac-detail-body > .z-input,
  .ik-ac-detail-body > .ik-ac-form,
  .ik-ac-detail-body > .ik-ac-form-actions,
  .ik-ac-detail-body > .ik-ac-btn,
  .ik-ac-detail-body > .ik-ac-empty,
  .ik-ac-detail-body > .ik-ac-security-send-hint,
  .ik-ac-detail-body > .ik-ac-loading {
    width: 100%;
    max-width: 420px;
    align-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-ac-btn,
  .ik-ac-row {
    transition: none;
  }
}
</style>
