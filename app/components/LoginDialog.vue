<script setup lang="ts">
import { useMessage } from "zenless-ui";
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
const isLoading = ref(false);
const isCodeSent = ref(false);
const isSendingCode = ref(false);
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

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
  isLoading.value = false;
  isCodeSent.value = false;
  cooldown.value = 0;
  stopCooldown();
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
    const res = await api.sendRegisterCode(form.email.trim());
    isCodeSent.value = true;
    form.email = res.email;
    startCooldown(res.cooldown);
    message.success("验证码已发送，请查收邮箱");
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送验证码失败"));
  } finally {
    isSendingCode.value = false;
  }
};

const submit = async () => {
  isLoading.value = true;

  try {
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
  } catch (err) {
    message.error(resolveErrorMessage(err, isRegister.value ? "注册失败" : "登录失败"));
  } finally {
    isLoading.value = false;
  }
};

const toggleMode = () => {
  isRegister.value = !isRegister.value;
  isCodeSent.value = false;
  form.code = "";
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

const handleEnterEmail = () => focusInput(passwordRef);
const handleEnterPassword = () => {
  if (isRegister.value) focusInput(confirmPasswordRef);
  else submit();
};
const handleEnterConfirmPassword = () => focusInput(codeRef);
const handleEnterCode = () => submit();

onUnmounted(() => {
  stopCooldown();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay">
      <div v-if="visible" class="ik-overlay" @mousedown.self="handleClose">
        <!-- 斜线纹理背景（与帖子弹窗一致） -->
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div class="ik-dialog" @click.stop>
          <!-- 外边框（半透明白色，三圆角） -->
          <div class="ik-dialog__outer">
            <!-- 内边框（纯黑，三圆角） -->
            <div class="ik-dialog__inner">
              <!-- Header Bar -->
              <div class="ik-dialog__header">
                <span class="ik-dialog__title">
                  {{ isRegister ? '注册' : '登录' }}
                </span>
                <button
                  class="ik-dialog__close"
                  aria-label="关闭"
                  @click="handleClose"
                >
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" />
                </button>
              </div>

              <!-- Content -->
              <div class="ik-dialog__body">
                <!-- Login / Register form -->
                  <div class="ik-login-form">
                    <z-input ref="emailRef" v-model="form.email" :placeholder="isRegister ? '邮箱' : '用户名/邮箱'" @keydown.enter="handleEnterEmail" />
                    <z-input
                      ref="passwordRef"
                      v-model="form.password"
                      type="password"
                      placeholder="密码"
                      @keydown.enter="handleEnterPassword"
                    />

                    <div class="ik-login-field-grid" :class="{ 'is-open': isRegister }">
                      <div class="ik-login-field-grid__inner">
                        <z-input
                          ref="confirmPasswordRef"
                          v-model="form.confirmPassword"
                          type="password"
                          placeholder="确认密码"
                          @keydown.enter="handleEnterConfirmPassword"
                        />
                      </div>
                    </div>

                    <div class="ik-login-field-grid" :class="{ 'is-open': isRegister }">
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
                  </div>

                  <div class="ik-login-footer">
                    <z-button @click="toggleMode">
                      {{ isRegister ? "返回登录" : "注册账号" }}
                    </z-button>
                    <z-button
                      v-if="!isLoading"
                      :icon="{ success: '#00cc0d' }"
                      @click="submit"
                    >
                      {{ isRegister ? "注册" : "登录" }}
                    </z-button>
                    <z-button v-if="isLoading" loading>
                      {{ isRegister ? "正在注册" : "正在登录" }}
                    </z-button>
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
   Overlay — 与帖子弹窗完全一致
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
}

/* ── Body ──────────────────────────────────────── */
.ik-dialog__body {
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
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

/* ── Form ──────────────────────────────────────── */
.ik-login-form {
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
  margin-top: 20px;
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
  color: #d7ff00;
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

/* ═══════════════════════════════════════════════
   Animations — 与帖子弹窗完全一致
   ═══════════════════════════════════════════════ */
@keyframes stripe-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes stripe-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* Enter */
.ik-overlay-enter-active {
  transition: background-color 80ms ease-out, backdrop-filter 80ms ease-out, -webkit-backdrop-filter 80ms ease-out;
}

.ik-overlay-enter-from {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-enter-active .ik-overlay__stripe {
  animation: stripe-fade-in 250ms ease-out both;
}

.ik-overlay-enter-active .ik-dialog {
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1),
              opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-overlay-enter-from .ik-overlay__stripe {
  opacity: 0;
}

.ik-overlay-enter-from .ik-dialog {
  opacity: 0;
  transform: translateX(5%);
}

/* Leave */
.ik-overlay-leave-active {
  transition: background-color 160ms ease-out,
              backdrop-filter 160ms ease-out,
              -webkit-backdrop-filter 160ms ease-out;
}

.ik-overlay-leave-active .ik-overlay__stripe {
  animation: stripe-fade-out 180ms ease-in both;
}

.ik-overlay-leave-active .ik-dialog {
  transition: transform 200ms cubic-bezier(0.55, 0, 1, 0.45),
              opacity 180ms ease-in;
}

.ik-overlay-leave-to {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-leave-to .ik-dialog {
  opacity: 0;
  transform: translateX(-5%);
}

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

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
  /* Keep the ZZZ-style 3-rounded-corner frame on mobile; the dialog is a
     centered popup, not a fullscreen sheet. */
}

@media (prefers-reduced-motion: reduce) {
  .ik-overlay-enter-active,
  .ik-overlay-enter-active .ik-dialog,
  .ik-overlay-leave-active,
  .ik-overlay-leave-active .ik-dialog {
    transition: none;
  }

  .ik-overlay-enter-active .ik-overlay__stripe,
  .ik-overlay-leave-active .ik-overlay__stripe {
    animation: none;
  }
}
</style>
