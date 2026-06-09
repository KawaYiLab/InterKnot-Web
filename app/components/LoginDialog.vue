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
const isReset = ref(false);
const isLoading = ref(false);
const isCodeSent = ref(false);
const isSendingCode = ref(false);
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

/** 当前模式的标题 */
const modeTitle = computed(() => {
  if (isReset.value) return "重置密码";
  if (isRegister.value) return "注册";
  return "登录";
});

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
                <div class="ik-login__wrapper">
                <div class="ik-login__inner">
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
                      :icon="{ success: '#00cc0d' }"
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
                      :icon="{ success: '#00cc0d' }"
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
                      :icon="{ success: '#00cc0d' }"
                      @click="submit"
                    >
                      {{ isRegister ? "注册" : "登录" }}
                    </z-button>
                    <z-button v-else loading>
                      {{ isRegister ? "注册" : "登录" }}
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

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
  /* Keep the ZZZ-style 3-rounded-corner frame on mobile; the dialog is a
     centered popup, not a fullscreen sheet. */
}

/* prefers-reduced-motion 由 theme.css 全局接管 */
</style>
