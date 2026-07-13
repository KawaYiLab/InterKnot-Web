<script setup lang="ts">
import { useMessage } from "zenless-ui";
import QRCode from "qrcode";
import { resolveErrorMessage } from "~/utils/api-error";

const api = useApi();
const auth = useAuthStore();
const { visible, close } = useLoginDialog();
const message = useMessage();
const form = reactive({
  email: "",
  code: "",
  password: "",
  confirmPassword: "",
});

const isRegister = ref(false);
const isReset = ref(false);
const isLoading = ref(false);
const isCodeSent = ref(false);
const isSendingCode = ref(false);
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

/** 当前模式的标题 */
const modeTitle = computed(() => {
  if (isMihoyo.value) return "米游社登录";
  if (isReset.value) return "重置密码";
  if (isRegister.value) return "注册";
  return "登录";
});

// ── 米游社扫码登录 ──────────────────────────────
type MihoyoQrStatus = "loading" | "waiting" | "scanned" | "confirmed" | "expired" | "cancelled" | "error";

const MIHOYO_POLL_INTERVAL_MS = 1500;

const isMihoyo = ref(false);
const mihoyoStatus = ref<MihoyoQrStatus>("loading");
const mihoyoQrDataUrl = ref("");
let mihoyoTicket = "";
let mihoyoPollTimer: ReturnType<typeof setTimeout> | null = null;
let mihoyoPolling = false;

const mihoyoStatusText = computed(() => {
  switch (mihoyoStatus.value) {
    case "loading": return "二维码生成中…";
    case "waiting": return "请使用米游社 App 扫码登录";
    case "scanned": return "已扫码，请在米游社 App 中确认";
    case "confirmed": return "登录中…";
    case "expired": return "二维码已过期，点击刷新";
    case "cancelled": return "已取消扫码，点击刷新重试";
    case "error": return "二维码获取失败，点击刷新重试";
  }
});

const mihoyoNeedRefresh = computed(() =>
  mihoyoStatus.value === "expired" || mihoyoStatus.value === "cancelled" || mihoyoStatus.value === "error",
);

const stopMihoyoPolling = () => {
  if (mihoyoPollTimer) {
    clearTimeout(mihoyoPollTimer);
    mihoyoPollTimer = null;
  }
  mihoyoPolling = false;
};

const scheduleMihoyoPoll = () => {
  if (!mihoyoPolling) return;
  mihoyoPollTimer = setTimeout(() => void pollMihoyo(), MIHOYO_POLL_INTERVAL_MS);
};

const pollMihoyo = async () => {
  if (!mihoyoPolling || !mihoyoTicket) return;
  try {
    const res = await api.pollMihoyoQr(mihoyoTicket);
    if (!mihoyoPolling) return;
    if (res.status !== "confirmed") {
      mihoyoStatus.value = res.status;
      if (res.status === "expired" || res.status === "cancelled") {
        stopMihoyoPolling();
      } else {
        scheduleMihoyoPoll();
      }
      return;
    }
    // confirmed（登录框内只会是 login 模式）
    mihoyoStatus.value = "confirmed";
    stopMihoyoPolling();
    if (res.mode === "login") {
      if (!res.auth.token) throw new Error("登录失败：未获取到 Token");
      const isNewUser = res.isNewUser;
      await onLoginSuccess(res.auth.token, res.auth.user);
      if (isNewUser) {
        message.success("完成入站考试后即可解锁发布委托、评论等功能");
        await navigateTo("/exam");
      }
    }
  } catch (err) {
    if (!mihoyoPolling && mihoyoStatus.value === "confirmed") {
      message.error(resolveErrorMessage(err, "登录失败"));
      mihoyoStatus.value = "error";
      return;
    }
    // 单次轮询失败不中断，继续重试
    scheduleMihoyoPoll();
  }
};

const startMihoyoQr = async () => {
  stopMihoyoPolling();
  mihoyoStatus.value = "loading";
  mihoyoQrDataUrl.value = "";
  mihoyoTicket = "";
  try {
    const res = await api.createMihoyoQr();
    mihoyoQrDataUrl.value = await QRCode.toDataURL(res.qrUrl, { width: 220, margin: 1 });
    if (!isMihoyo.value || !visible.value) return;
    mihoyoTicket = res.ticket;
    mihoyoStatus.value = "waiting";
    mihoyoPolling = true;
    scheduleMihoyoPoll();
  } catch (err) {
    mihoyoStatus.value = "error";
    message.error(resolveErrorMessage(err, "获取二维码失败"));
  }
};

const enterMihoyoMode = () => {
  isMihoyo.value = true;
  isRegister.value = false;
  isReset.value = false;
  void startMihoyoQr();
};

const exitMihoyoMode = () => {
  isMihoyo.value = false;
  stopMihoyoPolling();
  mihoyoQrDataUrl.value = "";
  mihoyoTicket = "";
};

const stopCooldown = () => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
};

const startCooldown = (seconds: number) => {
  stopCooldown();
  cooldown.value = Math.max(0, Math.floor(seconds));
  if (cooldown.value <= 0) return;
  cooldownTimer = setInterval(() => {
    cooldown.value = Math.max(0, cooldown.value - 1);
    if (cooldown.value <= 0) {
      stopCooldown();
    }
  }, 1000);
};

const resetForm = () => {
  form.email = "";
  form.code = "";
  form.password = "";
  form.confirmPassword = "";
  isRegister.value = false;
  isReset.value = false;
  isLoading.value = false;
  isCodeSent.value = false;
  cooldown.value = 0;
  stopCooldown();
  exitMihoyoMode();
};

const onLoginSuccess = async (token: string, user: Awaited<ReturnType<typeof api.getSelfUser>>) => {
  auth.setSession(token, user);
  resetForm();
  close();
  message.success(`登录成功，${user.name || user.username || "欢迎回来"}`);
  // Asynchronously fetch full user info (with author relation) in background
  try {
    const fullUser = await api.getSelfUser();
    auth.setSession(token, fullUser);
  } catch {
    // silently ignore — basic user info already stored
  }
};

const validateRegisterBase = () => {
  if (!form.email.trim() || !form.password.trim()) {
    throw new Error("请输入邮箱和密码");
  }
  if (form.password !== form.confirmPassword) {
    throw new Error("两次输入的密码不一致");
  }
};

const sendCode = async () => {
  if (!form.email.trim()) {
    message.error("请先输入邮箱");
    return;
  }
  isSendingCode.value = true;
  try {
    if (isReset.value) {
      const res = await api.sendResetCode(form.email.trim());
      isCodeSent.value = true;
      form.email = res.email;
      startCooldown(res.cooldown);
      message.success("验证码已发送，请查收邮箱");
    } else {
      const res = await api.sendRegisterCode(form.email.trim());
      isCodeSent.value = true;
      form.email = res.email;
      startCooldown(res.cooldown);
      message.success("验证码已发送，请查收邮箱");
    }
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送验证码失败"));
  } finally {
    isSendingCode.value = false;
  }
};

const submit = async () => {
  isLoading.value = true;

  try {
    if (isReset.value) {
      if (!form.email.trim()) throw new Error("请输入邮箱");
      if (!form.code.trim()) throw new Error("请输入验证码");
      if (!form.password.trim()) throw new Error("请输入新密码");
      if (form.password !== form.confirmPassword) throw new Error("两次输入的密码不一致");
      await api.resetPassword(form.email.trim(), form.code.trim(), form.password.trim());
      message.success("密码已重置，请使用新密码登录");
      isReset.value = false;
      isRegister.value = false;
      form.code = "";
      form.password = "";
      form.confirmPassword = "";
      isCodeSent.value = false;
      cooldown.value = 0;
      stopCooldown();
      return;
    }

    if (!isRegister.value) {
      if (!form.email.trim() || !form.password.trim()) {
        throw new Error("请输入邮箱和密码");
      }
      const loginRes = await api.login(form.email.trim(), form.password.trim());
      if (!loginRes.token) {
        throw new Error("登录失败：未获取到 Token");
      }
      await onLoginSuccess(loginRes.token, loginRes.user);
      return;
    }

    validateRegisterBase();
    if (!form.code.trim()) {
      throw new Error("请输入验证码");
    }
    const registerRes = await api.registerWithCode(
      form.email.trim(),
      form.code.trim(),
      form.password.trim(),
    );

    if (!registerRes.token) {
      throw new Error("注册失败：未获取到 Token");
    }
    await onLoginSuccess(registerRes.token, registerRes.user);
    // 新注册用户需通过入站考试才能发布委托/评论，注册成功后直接引导去考试页
    message.success("完成入站考试后即可解锁发布委托、评论等功能");
    await navigateTo("/exam");
  } catch (err) {
    const label = isReset.value ? "重置失败" : isRegister.value ? "注册失败" : "登录失败";
    message.error(resolveErrorMessage(err, label));
  } finally {
    isLoading.value = false;
  }
};

const toggleMode = () => {
  if (isReset.value) {
    isReset.value = false;
    isRegister.value = false;
  } else {
    isRegister.value = !isRegister.value;
  }
  isCodeSent.value = false;
  form.code = "";
  form.password = "";
  form.confirmPassword = "";
  cooldown.value = 0;
  stopCooldown();
};

const enterResetMode = () => {
  isReset.value = true;
  isRegister.value = false;
  isCodeSent.value = false;
  form.code = "";
  form.password = "";
  form.confirmPassword = "";
  cooldown.value = 0;
  stopCooldown();
};

const handleClose = () => {
  if (!isLoading.value) {
    resetForm();
    close();
  }
};

const emailRef = ref<{ $el: HTMLElement } | null>(null);
const passwordRef = ref<{ $el: HTMLElement } | null>(null);
const confirmPasswordRef = ref<{ $el: HTMLElement } | null>(null);
const codeRef = ref<{ $el: HTMLElement } | null>(null);

const focusInput = (ref: Ref<{ $el: HTMLElement } | null>) => {
  nextTick(() => ref.value?.$el?.querySelector('input')?.focus());
};

const handleEnterEmail = () => {
  if (isReset.value && !isCodeSent.value) {
    sendCode();
  } else {
    focusInput(passwordRef);
  }
};
const handleEnterPassword = () => {
  if (isRegister.value || isReset.value) focusInput(confirmPasswordRef);
  else submit();
};
const handleEnterConfirmPassword = () => focusInput(codeRef);
const handleEnterCode = () => submit();

onUnmounted(() => {
  stopCooldown();
  stopMihoyoPolling();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay">
      <div v-if="visible" class="ik-overlay" @mousedown.self="handleClose">
        <!-- 斜线纹理背景（与委托弹窗一致） -->
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div class="ik-dialog" @click.stop>
          <!-- 外边框（半透明白色，三圆角） -->
          <div class="ik-dialog__outer">
            <!-- 内边框（纯黑，三圆角） -->
            <div class="ik-dialog__inner">
              <!-- Header Bar -->
              <div class="ik-dialog__header">
                <span class="ik-dialog__title">
                  {{ modeTitle }}
                </span>
                <button
                  class="ik-dialog__close"
                  aria-label="关闭"
                  @click="handleClose"
                >
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                </button>
              </div>

              <!-- Content -->
              <div class="ik-dialog__body">
                <IkZzzMarquee />
                <div v-if="isMihoyo" class="ik-login__wrapper">
                  <div class="ik-login__inner">
                    <div class="ik-mihoyo">
                      <div class="ik-mihoyo__qr-box" :class="{ 'is-dimmed': mihoyoNeedRefresh }">
                        <img
                          v-if="mihoyoQrDataUrl"
                          :src="mihoyoQrDataUrl"
                          alt="米游社登录二维码"
                          class="ik-mihoyo__qr"
                          draggable="false"
                        />
                        <div v-else class="ik-mihoyo__qr-placeholder" />
                        <button
                          v-if="mihoyoNeedRefresh"
                          type="button"
                          class="ik-mihoyo__refresh"
                          @click="startMihoyoQr"
                        >
                          刷新二维码
                        </button>
                      </div>
                      <p class="ik-mihoyo__status" :class="`is-${mihoyoStatus}`">
                        {{ mihoyoStatusText }}
                      </p>
                      <p class="ik-mihoyo__hint">
                        确认后将自动登录，首次登录会使用绝区零玩家名创建账号
                      </p>
                    </div>
                  </div>
                  <div class="ik-login-footer">
                    <z-button @click="exitMihoyoMode">返回邮箱登录</z-button>
                  </div>
                </div>
                <div v-else class="ik-login__wrapper">
                <div class="ik-login__inner">
                <!-- 登录方式（仅登录模式展示）：第三方登录在上，邮箱表单在「或」下 -->
                <div v-if="!isRegister && !isReset" class="ik-login-methods">
                  <button type="button" class="ik-login-method-btn" @click="enterMihoyoMode">
                    <span class="ik-login-method-btn__icon" aria-hidden="true">米</span>
                    使用米游社继续
                  </button>
                  <div class="ik-login-divider" role="separator">
                    <span class="ik-login-divider__line" aria-hidden="true"></span>
                    <span class="ik-login-divider__text">或</span>
                    <span class="ik-login-divider__line" aria-hidden="true"></span>
                  </div>
                </div>
                <div class="ik-login-form">
                  <!-- 邮箱：始终可见 -->
                  <z-input
                    ref="emailRef"
                    v-model="form.email"
                    :placeholder="isReset ? '注册邮箱' : isRegister ? '邮箱' : '用户名/邮箱'"
                    @keydown.enter="handleEnterEmail"
                  />

                  <!-- 密码：登录/注册时直接显示，重置时验证码发送后展开 -->
                  <div class="ik-login-field-grid" :class="{ 'is-open': !isReset || (isReset && isCodeSent) }">
                    <div class="ik-login-field-grid__inner">
                      <z-input
                        ref="passwordRef"
                        v-model="form.password"
                        type="password"
                        :placeholder="isReset ? '新密码' : '密码'"
                        @keydown.enter="handleEnterPassword"
                      >
                        <template v-if="!isRegister && !isReset" #append>
                          <button
                            type="button"
                            class="ik-forgot-btn"
                            @click.stop="enterResetMode"
                          >
                            忘记密码
                          </button>
                        </template>
                      </z-input>
                    </div>
                  </div>

                  <!-- 确认密码：注册 或 重置(验证码已发送) -->
                  <div class="ik-login-field-grid" :class="{ 'is-open': isRegister || (isReset && isCodeSent) }">
                    <div class="ik-login-field-grid__inner">
                      <z-input
                        ref="confirmPasswordRef"
                        v-model="form.confirmPassword"
                        type="password"
                        :placeholder="isReset ? '确认新密码' : '确认密码'"
                        @keydown.enter="handleEnterConfirmPassword"
                      />
                    </div>
                  </div>

                  <!-- 验证码：注册 或 重置(验证码已发送) -->
                  <div class="ik-login-field-grid" :class="{ 'is-open': isRegister || (isReset && isCodeSent) }">
                    <div class="ik-login-field-grid__inner">
                      <z-input
                        ref="codeRef"
                        v-model="form.code"
                        placeholder="验证码"
                        @keydown.enter="handleEnterCode"
                      >
                        <template #suffix>
                          <span class="ik-code-divider" />
                          <button
                            class="ik-code-send-btn"
                            :disabled="cooldown > 0 || isSendingCode"
                            @click.stop="sendCode"
                          >
                            {{ isSendingCode ? '发送中' : cooldown > 0 ? `${cooldown}s` : (isCodeSent ? '重新发送' : '发送') }}
                          </button>
                        </template>
                      </z-input>
                    </div>
                  </div>

                  <!-- 底部留白：与字段共用 grid 动画，避免切换时顿挫 -->
                  <div
                    class="ik-login-field-grid ik-login-form-spacer"
                    :class="{ 'is-open': isRegister || (isReset && isCodeSent) }"
                  >
                    <div class="ik-login-field-grid__inner">
                      <div class="ik-login-form-spacer__fill" aria-hidden="true" />
                    </div>
                  </div>
                </div>

                </div>
                <div class="ik-login-footer">
                  <z-button @click="toggleMode">
                    {{ isReset || isRegister ? "返回登录" : "注册账号" }}
                  </z-button>

                  <!-- 重置模式 - 未发验证码 -->
                  <template v-if="isReset && !isCodeSent">
                    <z-button
                      v-if="!isSendingCode"
                      @click="sendCode"
                    >
                      重置密码
                    </z-button>
                    <z-button v-else loading>重置密码</z-button>
                  </template>

                  <!-- 重置模式 - 已发验证码 -->
                  <template v-else-if="isReset && isCodeSent">
                    <z-button
                      v-if="!isLoading"
                      @click="submit"
                    >
                      重置密码
                    </z-button>
                    <z-button v-else loading>重置密码</z-button>
                  </template>

                  <!-- 登录 / 注册模式 -->
                  <template v-else>
                    <z-button
                      v-if="!isLoading"
                      @click="submit"
                    >
                      {{ isRegister ? "注册账号" : "登录账号" }}
                    </z-button>
                    <z-button v-else loading>
                      {{ isRegister ? "注册账号" : "登录账号" }}
                    </z-button>
                  </template>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay — 与委托弹窗完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ik-overlay__stripe {
  position: absolute;
  inset: 0;
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

/* ── Dialog Shell ──────────────────────────────── */
.ik-dialog {
  position: relative;
  width: 440px;
  max-width: 90%;
  will-change: transform;
}

.ik-dialog__outer {
  width: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header ────────────────────────────────────── */
.ik-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px 24px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── Body ──────────────────────────────────────── */
.ik-dialog__body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Autofill override ─────────────────────────── */
.ik-login-form :deep(.z-input__inner:-webkit-autofill),
.ik-login-form :deep(.z-input__inner:-webkit-autofill:hover),
.ik-login-form :deep(.z-input__inner:-webkit-autofill:focus),
.ik-login-form :deep(.z-input__inner:-webkit-autofill:active) {
  -webkit-box-shadow: 0 0 0 1000px #1c1c1c inset !important;
  -webkit-text-fill-color: #fff !important;
  transition: background-color 5000s ease-in-out 0s;
  caret-color: #fff;
}

/* ── Wrapper / Panel (matches logout dialog) ──── */
.ik-login__wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ik-login__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 24px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

/* ── 登录方式（第三方登录 + 分隔线） ──────── */
.ik-login-methods {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.ik-login-method-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #111;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-login-method-btn:hover {
  opacity: 0.88;
}

.ik-login-method-btn:active {
  transform: scale(0.98);
}

.ik-login-method-btn__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #33c7fc;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.ik-login-divider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ik-login-divider__line {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
}

.ik-login-divider__text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

/* ── Form ──────────────────────────────────────── */
.ik-login-form {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-login-field-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Footer ────────────────────────────────────── */
.ik-login-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: -18px;
  position: relative;
  z-index: 1;
}

/* ── Inline send-code button ──────────────────── */
.ik-code-divider {
  display: inline-block;
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 8px;
  flex-shrink: 0;
}

.ik-code-send-btn {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #BFFF09;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 140ms ease;
}

.ik-code-send-btn:hover:not(:disabled) {
  opacity: 0.8;
}

.ik-code-send-btn:disabled {
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

/* ── 忘记密码（密码输入框 append 区域） ── */
.ik-forgot-btn {
  display: flex;
  align-items: center;
  padding: 0 14px 0 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 140ms ease;
}

.ik-forgot-btn:hover {
  color: rgba(255, 255, 255, 0.6);
}

/* 入场/出场动画统一在 theme.css 的 .ik-overlay-* 全局规则里维护 */

/* ── Field expand/collapse（grid 动画，无卡顿） ── */
.ik-login-field-grid {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1),
              opacity 300ms cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0;
}

.ik-login-field-grid.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.ik-login-field-grid__inner {
  overflow: hidden;
}

/* 登录时由折叠字段的 flex gap 占位；注册时展开 32px，抵消前一项 gap */
.ik-login-form-spacer {
  margin-top: -16px;
}

.ik-login-form-spacer__fill {
  height: 32px;
}

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
  /* Keep the ZZZ-style 3-rounded-corner frame on mobile; the dialog is a
     centered popup, not a fullscreen sheet. */
}

/* ── 米游社扫码 ───────────────────────── */
.ik-mihoyo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 8px 0 4px;
}

.ik-mihoyo__qr-box {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.ik-mihoyo__qr {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-mihoyo__qr-box.is-dimmed .ik-mihoyo__qr {
  filter: blur(3px) brightness(0.5);
}

.ik-mihoyo__qr-placeholder {
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
}

.ik-mihoyo__refresh {
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
  cursor: pointer;
}

.ik-mihoyo__status {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.ik-mihoyo__status.is-scanned,
.ik-mihoyo__status.is-confirmed {
  color: #bfff09;
}

.ik-mihoyo__status.is-expired,
.ik-mihoyo__status.is-cancelled,
.ik-mihoyo__status.is-error {
  color: #ff6b6b;
}

.ik-mihoyo__hint {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
}

/* prefers-reduced-motion 由 theme.css 全局接管 */
</style>
