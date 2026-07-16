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

// ── 米游社绑定 ──────────────────────────────
const mihoyoBinding = ref<MihoyoBinding | null>(null);
const mihoyoLoading = ref(true);
const mihoyoUnbinding = ref(false);

const mihoyo = useMihoyoQr({
  isActive: () => !mihoyoBinding.value,
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
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取绑定信息失败"));
  } finally {
    mihoyoLoading.value = false;
  }
  if (!mihoyoBinding.value) {
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

// ── 账号安全 ──────────────────────────────
const MIHOYO_PLACEHOLDER_EMAIL_SUFFIX = "@mihoyo-login.inter-knot.invalid";

const security = ref<AccountSecurity | null>(null);
const securityLoading = ref(false);
const securityAction = ref<null | "bind-email" | "set-password">(null);

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

const startBindEmail = () => {
  bindEmailInput.value = security.value?.email || "";
  bindCodeInput.value = "";
  securityAction.value = "bind-email";
};

const startSetPassword = () => {
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
  securityAction.value = "set-password";
};

const cancelSecurityAction = () => {
  securityAction.value = null;
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
    cancelSecurityAction();
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
    cancelSecurityAction();
  } catch (err) {
    message.error(resolveErrorMessage(err, "设置密码失败"));
  } finally {
    setPasswordLoading.value = false;
  }
};

// ── 黑名单管理 ──────────────────────────────
const blockedUsers = ref<BlockedUser[]>([]);
const blockedLoading = ref(false);
const blockedHasNext = ref(true);
const blockedCursor = ref("");
const blockedLoaded = ref(false);

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
    // 取消拉黑后让列表/搜索/个人页缓存失效，刷新后重新显示内容
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
  <div class="ik-ac">
    <div class="ik-ac__stripe" aria-hidden="true"></div>
    <div class="ik-ac__container">

      <!-- Hero -->
      <section class="ik-ac__hero">
        <h1 class="ik-ac__title">账号中心</h1>
        <p class="ik-ac__hero-hint">管理账号安全、绑定与社交黑名单</p>
      </section>

      <div class="ik-ac__grid">

      <!-- 账号安全 -->
      <section class="ik-ac__card">
        <div class="ik-ac__card-header">
          <h2 class="ik-ac__card-title">账号安全</h2>
          <span
            v-if="security"
            class="ik-ac__badge"
            :class="security.hasBoundEmail ? 'ik-ac__badge--on' : 'ik-ac__badge--off'"
          >
            {{ securityLoading ? '加载中' : security.hasBoundEmail ? '已绑定邮箱' : '未绑定邮箱' }}
          </span>
        </div>

        <div class="ik-ac__card-body">
          <template v-if="securityLoading">
            <p class="ik-ac__loading">加载中…</p>
          </template>

          <template v-else-if="!securityAction">
            <div class="ik-ac__security-list">
              <div class="ik-ac__security-row">
                <span class="ik-ac__security-label">邮箱</span>
                <span
                  class="ik-ac__security-value"
                  :class="{ 'ik-ac__security-value--empty': !security?.hasBoundEmail }"
                >
                  {{ security?.hasBoundEmail ? security.email : '未绑定' }}
                </span>
                <button class="ik-ac__btn ik-ac__btn--small" @click="startBindEmail">
                  {{ security?.hasBoundEmail ? '修改邮箱' : '绑定邮箱' }}
                </button>
              </div>

              <div class="ik-ac__security-row">
                <span class="ik-ac__security-label">密码</span>
                <span
                  class="ik-ac__security-value"
                  :class="{ 'ik-ac__security-value--empty': !security?.hasPassword }"
                >
                  {{ security?.hasPassword ? '已设置' : '未设置' }}
                </span>
                <button
                  class="ik-ac__btn ik-ac__btn--small"
                  :disabled="!security?.hasBoundEmail"
                  @click="startSetPassword"
                >
                  {{ security?.hasPassword ? '修改密码' : '设置密码' }}
                </button>
              </div>

              <p v-if="security?.provider === 'mihoyo'" class="ik-ac__security-tip">
                你当前通过米游社登录，建议绑定邮箱并设置密码，方便换设备登录和解绑米游社。
              </p>

              <button class="ik-ac__btn ik-ac__btn--danger" @click="logout">
                退出登录
              </button>
            </div>
          </template>

          <template v-else-if="securityAction === 'bind-email'">
            <div class="ik-ac__security-form">
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
              <div class="ik-ac__security-actions">
                <button
                  class="ik-ac__btn"
                  :disabled="bindEmailLoading"
                  @click="confirmBindEmail"
                >
                  确认绑定
                </button>
                <button class="ik-ac__btn ik-ac__btn--ghost" @click="cancelSecurityAction">
                  取消
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="securityAction === 'set-password'">
            <div class="ik-ac__security-form">
              <p class="ik-ac__security-send-hint">
                验证码将发送至 {{ security?.email }}
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
              <div class="ik-ac__security-actions">
                <button
                  class="ik-ac__btn"
                  :disabled="setPasswordLoading"
                  @click="confirmSetPassword"
                >
                  确认
                </button>
                <button class="ik-ac__btn ik-ac__btn--ghost" @click="cancelSecurityAction">
                  取消
                </button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- 米游社绑定 -->
      <section class="ik-ac__card">
        <div class="ik-ac__card-header">
          <h2 class="ik-ac__card-title">米游社绑定</h2>
          <span
            class="ik-ac__badge"
            :class="mihoyoBinding ? 'ik-ac__badge--on' : 'ik-ac__badge--off'"
          >
            {{ mihoyoLoading ? '加载中' : mihoyoBinding ? '已绑定' : '未绑定' }}
          </span>
        </div>

        <div class="ik-ac__card-body">
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
      </section>

      <!-- 黑名单管理 -->
      <section class="ik-ac__card">
        <div class="ik-ac__card-header">
          <h2 class="ik-ac__card-title">黑名单管理</h2>
          <span v-if="blockedUsers.length" class="ik-ac__badge ik-ac__badge--neutral">
            {{ blockedUsers.length }}{{ blockedHasNext ? '+' : '' }} 人
          </span>
        </div>

        <div class="ik-ac__card-body">
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
      </section>

      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Page container（与绳网等级 / 权益中心页一致的视觉体系） ── */
.ik-ac {
  position: relative;
  width: 100%;
  min-height: 100vh;
  padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px));
}

.ik-ac__stripe {
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

.ik-ac__container {
  position: relative;
  z-index: 1;
  max-width: 520px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-ac__grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Hero ── */
.ik-ac__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0 12px;
}

.ik-ac__title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.ik-ac__hero-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Card ── */
.ik-ac__card {
  background: rgba(18, 18, 20, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.ik-ac__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
}

.ik-ac__card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.2px;
}

.ik-ac__badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
}

.ik-ac__badge--on {
  color: #bfff09;
  background: rgba(191, 255, 9, 0.1);
}

.ik-ac__badge--off {
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.06);
}

.ik-ac__badge--neutral {
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
}

.ik-ac__card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px 20px 20px;
}

.ik-ac__loading {
  margin: 0;
  padding: 12px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── 米游社绑定 ── */
.ik-ac__mihoyo-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 14px 18px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
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
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  text-align: right;
  word-break: break-all;
}

.ik-ac__qr-box {
  position: relative;
  width: 180px;
  height: 180px;
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
  padding: 28px 0;
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
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
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
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  background: linear-gradient(135deg, #4661fd 0%, #10bff0 100%);
  color: #fff;
  -webkit-tap-highlight-color: transparent;
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

/* ── 账号安全 ── */
.ik-ac__security-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.ik-ac__security-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
}

.ik-ac__security-label {
  flex-shrink: 0;
  width: 44px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}

.ik-ac__security-value {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-ac__security-value--empty {
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

.ik-ac__security-tip {
  margin: 0;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(191, 255, 9, 0.06);
  border: 1px solid rgba(191, 255, 9, 0.12);
  border-radius: 12px;
}

.ik-ac__security-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.ik-ac__security-form :deep(.z-input) {
  width: 100%;
}

.ik-ac__security-code {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-ac__security-code :deep(.z-input) {
  flex: 1;
}

.ik-ac__security-actions {
  display: flex;
  gap: 12px;
}

.ik-ac__security-actions .ik-ac__btn {
  flex: 1;
}

.ik-ac__security-send-hint {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
}

/* ── Desktop ── */
@media (min-width: 900px) {
  .ik-ac {
    padding-top: 48px;
    padding-bottom: 80px;
  }

  .ik-ac__container {
    max-width: 960px;
    gap: 20px;
  }

  /* 横向 hero：标题居左 */
  .ik-ac__hero {
    flex-direction: row;
    align-items: baseline;
    justify-content: flex-start;
    gap: 14px;
    padding: 0 4px 4px;
  }

  .ik-ac__title {
    font-size: 32px;
  }

  .ik-ac__hero-hint {
    margin: 0;
    font-size: 14px;
  }

  /* 双栏卡片 */
  .ik-ac__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    align-items: start;
  }

  .ik-ac__card-header {
    padding: 24px 28px 0;
  }

  .ik-ac__card-title {
    font-size: 19px;
  }

  .ik-ac__card-body {
    padding: 18px 28px 24px;
  }

  .ik-ac__card {
    min-height: 340px;
    display: flex;
    flex-direction: column;
  }

  .ik-ac__card-body {
    flex: 1;
    justify-content: flex-start;
  }

  .ik-ac__qr-box {
    width: 200px;
    height: 200px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-ac__btn { transition: none; }
}
</style>
