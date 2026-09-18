<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ComputerDesktopIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  LockClosedIcon,
  NoSymbolIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
} from "@heroicons/vue/24/outline";
import { normalizeApiError, resolveErrorMessage } from "~/utils/api-error";
import { formatFullTime } from "~/utils/time";
import { parseUserAgent } from "~/utils/device";
import { groupSessionsByDate } from "~/utils/session-display";
import type { AuthSessionItem } from "~/types/entities";

const auth = useAuthStore();
const api = useApi();
const message = useMessage();
const route = useRoute();
const confirmDialog = useConfirmDialog();
const loginDialog = useLoginDialog();
const accountData = useAccountData();

const {
  security,
  securityLoading,
  securityLoaded,
  securityError,
  ensureSecurity,
  mihoyoBinding,
  mihoyoLoading,
  mihoyoLoaded,
  mihoyoUnbinding,
  blockedUsers,
  blockedLoading,
  blockedLoaded,
  blockedHasNext,
  sessions,
  sessionsLoading,
  sessionsError,
  sessionsLoaded,
  sessionsRevoking,
  ensureLoaded,
  ensureMihoyo,
  ensureBlocked,
  ensureSessions,
  fetchSessions,
  revokeSingleSession,
  revokeOtherSessions,
  loadBlocked,
  setSecurity,
  setPasswordDone,
  setMihoyoBinding,
  unbindMihoyo: unbindMihoyoAction,
  unblockUser: unblockUserAction,
} = accountData;

// ── 页面视图 ─────────────────────────────────
type AccountMenuKey = "account" | "devices" | "mihoyo" | "blacklist";
type AccountSubView = "" | "email" | "password" | "delete";
const activeMenuKey = ref<AccountMenuKey>("account");
const activeSubView = ref<AccountSubView>("");
const panelTransitionName = ref("ik-ac-fade");
const panelKey = computed(() => `${activeMenuKey.value}:${activeSubView.value}`);

// 移动端：首屏改为单栏分组列表，点击后进入对应二级面板
const isMobile = useMediaQuery("(max-width: 900px)");
const atRoot = computed(
  () => activeMenuKey.value === "account" && activeSubView.value === "",
);

const onMenuChange = (name: string | number) => {
  const key = String(name) as AccountMenuKey;
  panelTransitionName.value = isMobile.value && atRoot.value ? "ik-ac-slide-right" : "ik-ac-fade";
  activeMenuKey.value = key;
  activeSubView.value = "";
  if (key === "devices") {
    void ensureSessions();
  } else if (key === "mihoyo") {
    if (!mihoyoLoaded.value) {
      ensureMihoyo().then(() => {
        if (!mihoyoBinding.value && activeMenuKey.value === "mihoyo") {
          void startMihoyoQr();
        }
      });
    } else if (!mihoyoBinding.value) {
      void startMihoyoQr();
    }
  } else if (key === "blacklist") {
    void ensureBlocked(true);
  }
};

// ── 米游社绑定 ─────────────────────────────
const mihoyo = useMihoyoQr({
  mode: "bind",
  isActive: () => activeMenuKey.value === "mihoyo" && !mihoyoBinding.value,
  width: 200,
  onConfirmed: (res) => {
    setMihoyoBinding(res.binding);
    message.success("米游社账号绑定成功");
  },
  onError: (err) => {
    message.error(resolveErrorMessage(err, "米游社绑定失败"));
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
    case "retrying": return "网络不太稳定，正在重试…";
    case "confirmed": return "绑定中…";
    case "expired": return "二维码已过期，点击刷新";
    case "cancelled": return "已取消扫码，点击刷新重试";
    case "error": return "绑定失败，点击刷新重试";
    default: return "点击刷新重试";
  }
});

// ── 注销专用：重新扫码核验米游社账号 ─────────────
const deleteMihoyo = useMihoyoQr({
  mode: "delete",
  isActive: () =>
    activeMenuKey.value === "account" &&
    activeSubView.value === "delete" &&
    deleteNeedsScan.value,
  width: 200,
  onConfirmed: (res) => {
    // res.matched=true 表示扫到的就是当前账号本人；false 则提示换号重扫
    if (res.matched) {
      deleteScanVerified.value = true;
    } else {
      deleteScanVerified.value = false;
      message.error("扫码的米游社账号与当前账号不一致，请使用当前账号绑定的米游社扫码");
    }
  },
  onError: (err) => {
    deleteScanVerified.value = false;
    message.error(resolveErrorMessage(err, "扫码核验失败，请刷新重试"));
  },
});

const deleteQrDataUrl = deleteMihoyo.qrDataUrl;
const deleteQrStatus = deleteMihoyo.qrStatus;
const deleteQrNeedRefresh = deleteMihoyo.qrNeedRefresh;

// Confirmed 但未匹配也算「需重扫」：状态停在 confirmed，但核验没过
const deleteScanNeedRefresh = computed(
  () => deleteQrNeedRefresh.value || (deleteQrStatus.value === "confirmed" && !deleteScanVerified.value),
);

const deleteQrStatusText = computed(() => {
  if (deleteScanVerified.value) return "核验通过，请点击下方「确认注销」";
  // Confirmed 但未 verified = 扫到的不是本人：明确提示换号重扫，不能显示「核验中…」
  if (deleteQrStatus.value === "confirmed") return "扫码账号与当前账号不一致，请刷新后用本账号绑定的米游社重扫";
  switch (deleteQrStatus.value) {
    case "loading": return "二维码生成中…";
    case "waiting": return "请使用米游社 App 扫码核验";
    case "scanned": return "已扫码，请在米游社 App 中确认";
    case "retrying": return "网络不太稳定，正在重试…";
    case "expired": return "二维码已过期，点击刷新";
    case "cancelled": return "已取消扫码，点击刷新重试";
    case "error": return "核验失败，点击刷新重试";
    default: return "点击刷新重试";
  }
});

const refreshDeleteQr = () => {
  deleteScanVerified.value = false;
  void deleteMihoyo.startQr();
};

// 进入/离开注销页且为纯扫码号时，自动起停扫码轮询
watch(
  () => activeMenuKey.value === "account" && activeSubView.value === "delete" && deleteNeedsScan.value,
  (needScan) => {
    if (needScan) {
      deleteScanVerified.value = false;
      void deleteMihoyo.startQr();
    } else {
      deleteMihoyo.stopQr();
    }
  },
);

const mihoyoMetaText = computed(() => {
  if (mihoyoLoading.value) return "加载中";
  return mihoyoBinding.value ? (mihoyoBinding.value.zzzNickname || "已绑定") : "未绑定";
});

const unbindMihoyo = async () => {
  if (mihoyoOnlyAccount.value) {
    message.warning("当前账号仅可通过米游社登录，解绑将导致账号失联。请先绑定邮箱，或在「账号」中注销当前账号");
    return;
  }
  const confirmed = await confirmDialog.open({
    title: "解除米哈游账号绑定",
    message: "解绑后将无法再使用该米哈游账号登录此绳网账号，确定解除绑定吗？",
    confirmText: "确认解绑",
    cancelText: "取消",
    danger: true,
  });
  if (!confirmed) return;

  await unbindMihoyoAction();
  void startMihoyoQr();
};

/**
 * 「只能靠米游社扫码登录」的账号：没有真邮箱、也没自设密码。
 * 这种号找不回、也解不了绑（服务端 unbind 会拒），是未登录扫码误建出来的典型形态。
 * 条件与服务端 unbind 的判定保持一致。
 */
const mihoyoOnlyAccount = computed(
  () => security.value?.provider === "mihoyo" && !security.value?.hasBoundEmail,
);

// ── 账号安全 ─────────────────────────────────
const bindEmailInput = ref("");
const bindCodeInput = ref("");
const bindEmailLoading = ref(false);

const setPasswordCodeInput = ref("");
const setPasswordInput = ref("");
const setPasswordConfirmInput = ref("");
const setPasswordLoading = ref(false);

// ── 注销核验 ─────────────────────────────────
// 注销核验方式由账号是否有真实邮箱决定：
//  - 有邮箱 → 邮箱验证码（deleteCodeInput）
//  - 纯米游社扫码号 → 重新扫码同一米游社账号（deleteMihoyo）
const deleteCodeInput = ref("");
const deleteCodeLoading = ref(false);
// 纯扫码号：无绑定真实邮箱（占位邮箱不算）
const deleteNeedsScan = computed(
  () => securityLoaded.value && !security.value?.hasBoundEmail,
);
// 扫码核验通过（matched）后待用户点「确认」才真正注销；ticket 从 composable 取
const deleteScanVerified = ref(false);

// 发码冷却按用途各自独立：服务端冷却是按 (email, purpose) 计的，绑定邮箱 / 设置密码 /
// 注销三处发码互不影响，共用一个计数会让一处发码把另两处的「发送」按钮误锁住。
type CodePurpose = "bind" | "password" | "delete";
const codeCooldowns = reactive<Record<CodePurpose, number>>({ bind: 0, password: 0, delete: 0 });
const codeCooldownTimers: Partial<Record<CodePurpose, ReturnType<typeof setInterval>>> = {};

const startCodeCooldown = (purpose: CodePurpose, seconds: number) => {
  const existing = codeCooldownTimers[purpose];
  if (existing) clearInterval(existing);
  codeCooldowns[purpose] = seconds;
  codeCooldownTimers[purpose] = setInterval(() => {
    codeCooldowns[purpose] -= 1;
    if (codeCooldowns[purpose] <= 0) {
      clearInterval(codeCooldownTimers[purpose]);
      delete codeCooldownTimers[purpose];
    }
  }, 1000);
};

onBeforeUnmount(() => {
  for (const timer of Object.values(codeCooldownTimers)) {
    if (timer) clearInterval(timer);
  }
});

const accountMetaText = computed(() => {
  if (securityLoading.value) return "加载中";
  if (security.value?.hasBoundEmail) return security.value.email;
  if (security.value?.hasPassword) return "已设置密码";
  return "未绑定邮箱";
});

const openEmail = () => {
  panelTransitionName.value = "ik-ac-slide-right";
  activeSubView.value = "email";
  bindEmailInput.value = security.value?.email || "";
  bindCodeInput.value = "";
};

const openPassword = () => {
  panelTransitionName.value = "ik-ac-slide-right";
  activeSubView.value = "password";
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
};

const deleteLoading = ref(false);

const openDeleteAccount = () => {
  panelTransitionName.value = "ik-ac-slide-right";
  activeMenuKey.value = "account";
  activeSubView.value = "delete";
  deleteCodeInput.value = "";
  deleteScanVerified.value = false;
  // 起停扫码交给 watch(deleteNeedsScan) 处理，这里只需刷新安全信息
  void ensureSecurity(true);
};

// 向本人已绑定的真实邮箱发送注销验证码（纯扫码号无真实邮箱，UI 不会显示此按钮）
const sendDeleteCode = async () => {
  if (!security.value?.hasBoundEmail) {
    message.warning("当前账号未绑定邮箱，请通过重新扫码米游社账号注销");
    return;
  }
  deleteCodeLoading.value = true;
  try {
    const res = await api.sendDeleteAccountCode();
    message.success("验证码已发送");
    startCodeCooldown("delete", res.cooldown || 60);
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送验证码失败"));
  } finally {
    deleteCodeLoading.value = false;
  }
};

const handleDeleteAccount = async () => {
  if (!securityLoaded.value || securityLoading.value || securityError.value || deleteLoading.value) return;

  // 提交前的本地校验：邮箱路径要有验证码，扫码路径要已核验通过
  if (deleteNeedsScan.value) {
    if (!deleteScanVerified.value) {
      message.warning("请先使用当前账号绑定的米游社扫码核验");
      return;
    }
  } else if (!deleteCodeInput.value.trim()) {
    message.warning("请输入邮箱验证码");
    return;
  }

  const generation = auth.generation;
  const confirmed = await confirmDialog.open({
    title: "注销账号确认",
    message: "确定要注销此账号吗？注销后此账号将被永久删除，此操作不可撤回！",
    confirmText: "确认",
    cancelText: "取消",
    danger: true,
  });
  if (!confirmed || generation !== auth.generation) return;

  deleteLoading.value = true;
  try {
    await api.deleteAccount(
      deleteNeedsScan.value
        ? { ticket: deleteMihoyo.getTicket() || undefined }
        : { code: deleteCodeInput.value.trim() },
    );
    if (generation !== auth.generation) return;
    message.success("账号已成功注销");
    auth.clearSession();
    await navigateTo("/");
  } catch (err: any) {
    message.error(resolveErrorMessage(err, "注销账号失败"));
    // 扫码 ticket 一次性，失败后必须重扫；邮箱验证码可重填，不清空
    if (deleteNeedsScan.value) {
      deleteScanVerified.value = false;
      void deleteMihoyo.startQr();
    }
  } finally {
    deleteLoading.value = false;
  }
};

const goBack = () => {
  panelTransitionName.value = "ik-ac-slide-left";
  stopMihoyoQr();
  deleteMihoyo.stopQr();
  activeMenuKey.value = "account";
  activeSubView.value = "";
  bindEmailInput.value = "";
  bindCodeInput.value = "";
  setPasswordCodeInput.value = "";
  setPasswordInput.value = "";
  setPasswordConfirmInput.value = "";
  deleteCodeInput.value = "";
  deleteScanVerified.value = false;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * 邮箱被别的账号占用，且当前号只能扫码登录——这几乎一定是同一个人：
 * 他填的是自己主账号的邮箱。告知用户需在当前页面注销小号释放米游社绑定后再登主账号绑定。
 */
const isEmailTakenByOwnAccount = (err: unknown) =>
  normalizeApiError(err).code === "EMAIL_ALREADY_TAKEN" && mihoyoOnlyAccount.value;

const handleEmailTakenByOwnAccount = async () => {
  const proceedToDelete = await confirmDialog.open({
    title: "该邮箱属于你的另一个账号",
    message:
      "该邮箱已绑定在你的另一个账号上。若你想将当前的米游社账号绑定至该主账号，因米游社账号同一时间只能绑定一个绳网账号，请先在当前页面完成「注销账号」以释放绑定，然后再登录主账号进行绑定。",
    confirmText: "前往注销账号",
    cancelText: "换个邮箱",
  });
  if (!proceedToDelete) return;
  openDeleteAccount();
};

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
    startCodeCooldown("bind", res.cooldown || 60);
  } catch (err) {
    if (isEmailTakenByOwnAccount(err)) {
      await handleEmailTakenByOwnAccount();
    } else {
      message.error(resolveErrorMessage(err, "发送验证码失败"));
    }
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

// 「清除」只清注销页的输入态（验证码 / 扫码核验），不离开页面，与绑定邮箱 / 改密页一致
const clearDeleteForm = () => {
  deleteCodeInput.value = "";
  deleteScanVerified.value = false;
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
    setSecurity(res);
    auth.updateUserPartial({ email });
    message.success("邮箱绑定成功");
    goBack();
  } catch (err) {
    if (isEmailTakenByOwnAccount(err)) {
      await handleEmailTakenByOwnAccount();
    } else {
      message.error(resolveErrorMessage(err, "绑定邮箱失败"));
    }
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
    startCodeCooldown("password", res.cooldown || 60);
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
    await api.resetPassword(security.value!.email, code, password);
    const hadPassword = security.value?.hasPassword === true;
    setPasswordDone();
    message.success(hadPassword ? "密码修改成功" : "密码设置成功");
    goBack();
  } catch (err) {
    message.error(resolveErrorMessage(err, "设置密码失败"));
  } finally {
    setPasswordLoading.value = false;
  }
};

// ── 设备与会话管理 ─────────────────────────────
const devicesMetaText = computed(() => {
  if (sessionsLoading.value && !sessions.value.length) return "加载中";
  if (!sessionsLoaded.value && !sessions.value.length) return "管理登录设备";
  return sessions.value.length ? `${sessions.value.length} 个会话` : "0 个会话";
});

const sessionGroups = computed(() => groupSessionsByDate(sessions.value));

const hasOtherSessions = computed(() => {
  return sessions.value.some((s) => !s.isCurrent);
});

const handleRevokeSingle = async (session: AuthSessionItem) => {
  if (session.isCurrent) return;
  const generation = auth.generation;

  const uaInfo = parseUserAgent(session.userAgent);
  const ok = await confirmDialog.open({
    title: "下线设备",
    message: `确定要下线该设备（${uaInfo.label}）吗？下线后该设备需要重新登录。`,
    confirmText: "下线",
    cancelText: "取消",
    danger: true,
  });
  if (!ok || generation !== auth.generation) return;
  await revokeSingleSession(session.id);
};

const handleRevokeOthers = async () => {
  const generation = auth.generation;
  const otherCount = sessions.value.filter((s) => !s.isCurrent).length;
  if (otherCount === 0) {
    message.warning("当前没有其他已登录设备");
    return;
  }

  const ok = await confirmDialog.open({
    title: "下线其他所有设备",
    message: `确定要下线除当前设备外的全部 ${otherCount} 个会话吗？这些设备将立即失效并需要重新登录。`,
    confirmText: "确认",
    cancelText: "取消",
    danger: true,
  });
  if (!ok || generation !== auth.generation) return;
  await revokeOtherSessions();
};

// ── 黑名单管理 ─────────────────────────────
const blacklistMetaText = computed(() => {
  if (blockedLoading.value) return "加载中";
  if (!blockedLoaded.value) return "管理屏蔽的用户";
  return blockedUsers.value.length ? `${blockedUsers.value.length} 个用户` : "0 个用户";
});

onMounted(async () => {
  await auth.hydrateFromStorage();
  if (!auth.isLogin) {
    loginDialog.open();
    await navigateTo("/");
    return;
  }
  void ensureLoaded();
  // 支持通过链接直接打开绑定邮箱或设备会话页。
  if (route.query.view === "email") {
    activeMenuKey.value = "account";
    activeSubView.value = "email";
  } else if (route.query.view === "devices") {
    activeMenuKey.value = "devices";
    void ensureSessions();
  }
});

useHead({ title: "账号中心" });
</script>

<template>
  <section class="ik-account-page">
    <p v-if="!auth.hydrationReady" class="ik-ac-loading">正在恢复登录状态…</p>
    <div v-else-if="auth.isLogin" class="ik-account-page__columns">
      <aside v-if="!isMobile" class="ik-account-page__nav">
        <z-menu class="ik-account-menu" :model-value="activeMenuKey" @change="onMenuChange">
          <z-menu-item name="account">
            <div class="ik-account-menu__content">
              <UserIcon class="ik-account-menu__icon" />
              <div class="ik-account-menu__text">
                <span class="ik-account-menu__title">账号</span>
                <span class="ik-account-menu__meta">{{ accountMetaText }}</span>
              </div>
            </div>
          </z-menu-item>

          <z-menu-item name="devices">
            <div class="ik-account-menu__content">
              <ComputerDesktopIcon class="ik-account-menu__icon" />
              <div class="ik-account-menu__text">
                <span class="ik-account-menu__title">已登录设备与会话</span>
                <span class="ik-account-menu__meta">{{ devicesMetaText }}</span>
              </div>
            </div>
          </z-menu-item>

          <z-menu-item name="mihoyo">
            <div class="ik-account-menu__content">
              <LinkIcon class="ik-account-menu__icon" />
              <div class="ik-account-menu__text">
                <span class="ik-account-menu__title">连接</span>
                <span class="ik-account-menu__meta">{{ mihoyoMetaText }}</span>
              </div>
            </div>
          </z-menu-item>

          <z-menu-item name="blacklist">
            <div class="ik-account-menu__content">
              <NoSymbolIcon class="ik-account-menu__icon" />
              <div class="ik-account-menu__text">
                <span class="ik-account-menu__title">黑名单</span>
                <span class="ik-account-menu__meta">{{ blacklistMetaText }}</span>
              </div>
            </div>
          </z-menu-item>
        </z-menu>
      </aside>

      <div class="ik-account-page__panel">
        <div class="ik-account-page__panel-body">
          <Transition :name="panelTransitionName" mode="out-in">
          <div :key="panelKey" class="ik-ac-panel-state">
          <!-- 移动端首屏：单栏分组列表 -->
          <template v-if="isMobile && atRoot">
            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">账号</span>
              </div>
              <button class="ik-ac-row" @click="openEmail">
                <span class="ik-ac-row__label">
                  <EnvelopeIcon class="ik-ac-row__icon" aria-hidden="true" />
                  邮箱
                </span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
              <button class="ik-ac-row" @click="openPassword">
                <span class="ik-ac-row__label">
                  <LockClosedIcon class="ik-ac-row__icon" aria-hidden="true" />
                  密码
                </span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                >
                  {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
              <button class="ik-ac-row ik-ac-row--danger" @click="openDeleteAccount">
                <span class="ik-ac-row__label ik-ac-row__label--danger">
                  <TrashIcon class="ik-ac-row__icon" aria-hidden="true" />
                  注销账号
                </span>
                <span class="ik-ac-row__value is-danger">永久注销</span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
            </div>

            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">设备与安全</span>
              </div>
              <button class="ik-ac-row" @click="onMenuChange('devices')">
                <span class="ik-ac-row__label">
                  <ComputerDesktopIcon class="ik-ac-row__icon" aria-hidden="true" />
                  已登录设备与会话
                </span>
                <span class="ik-ac-row__value">{{ devicesMetaText }}</span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
            </div>

            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">连接</span>
              </div>
              <button class="ik-ac-row" @click="onMenuChange('mihoyo')">
                <span class="ik-ac-row__label">
                  <LinkIcon class="ik-ac-row__icon" aria-hidden="true" />
                  米哈游账号
                </span>
                <span
                  class="ik-ac-row__value"
                  :class="{ 'is-empty': !mihoyoBinding && !mihoyoLoading }"
                >
                  {{ mihoyoMetaText }}
                </span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
            </div>

            <div class="ik-ac-section">
              <div class="ik-ac-section__head">
                <span class="ik-ac-section__label">黑名单</span>
              </div>
              <button class="ik-ac-row" @click="onMenuChange('blacklist')">
                <span class="ik-ac-row__label">
                  <NoSymbolIcon class="ik-ac-row__icon" aria-hidden="true" />
                  黑名单
                </span>
                <span class="ik-ac-row__value">{{ blacklistMetaText }}</span>
                <span class="ik-ac-row__chevron" aria-hidden="true">
                  <ChevronRightIcon aria-hidden="true" />
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
                    <EnvelopeIcon class="ik-ac-row__icon" aria-hidden="true" />
                    邮箱
                  </span>
                  <span
                    class="ik-ac-row__value"
                    :class="{ 'is-empty': !security?.hasBoundEmail && !securityLoading }"
                  >
                    {{ securityLoading ? '加载中' : security?.hasBoundEmail ? security.email : '未绑定' }}
                  </span>
                  <span class="ik-ac-row__chevron" aria-hidden="true">
                    <ChevronRightIcon aria-hidden="true" />
                  </span>
                </button>

                <button class="ik-ac-row" @click="openPassword">
                  <span class="ik-ac-row__label">
                    <LockClosedIcon class="ik-ac-row__icon" aria-hidden="true" />
                    密码
                  </span>
                  <span
                    class="ik-ac-row__value"
                    :class="{ 'is-empty': !security?.hasPassword && !securityLoading }"
                  >
                    {{ securityLoading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
                  </span>
                  <span class="ik-ac-row__chevron" aria-hidden="true">
                    <ChevronRightIcon aria-hidden="true" />
                  </span>
                </button>

                <button class="ik-ac-row ik-ac-row--danger" @click="openDeleteAccount">
                  <span class="ik-ac-row__label ik-ac-row__label--danger">
                    <TrashIcon class="ik-ac-row__icon" aria-hidden="true" />
                    注销账号
                  </span>
                  <span class="ik-ac-row__value is-danger">永久注销</span>
                  <span class="ik-ac-row__chevron" aria-hidden="true">
                    <ChevronRightIcon aria-hidden="true" />
                  </span>
                </button>
              </div>
            </template>

            <template v-else-if="activeSubView === 'email'">
              <header class="ik-ac-detail-header ik-ac-detail-header--stacked">
                <button class="ik-ac-back" aria-label="返回" @click="goBack">
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <h2 class="ik-ac-detail-title">邮箱</h2>
                <div class="ik-ac-detail-spacer" />
              </header>

              <div class="ik-ac-detail-body ik-ac-detail-body--pushed">
                <template v-if="securityLoading">
                  <p class="ik-ac-loading">加载中…</p>
                </template>
                <template v-else>
                  <z-form class="ik-ac-form" label-position="top">
                    <z-form-item label="新邮箱">
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
                            :disabled="codeCooldowns.bind > 0 || bindEmailLoading"
                            @click="sendBindEmailCode"
                          >
                            {{ bindEmailLoading ? '发送中' : codeCooldowns.bind > 0 ? `${codeCooldowns.bind}s` : '发送' }}
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
              <header class="ik-ac-detail-header ik-ac-detail-header--stacked">
                <button class="ik-ac-back" aria-label="返回" @click="goBack">
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <h2 class="ik-ac-detail-title">密码</h2>
                <div class="ik-ac-detail-spacer" />
              </header>

              <div class="ik-ac-detail-body ik-ac-detail-body--pushed">
                <template v-if="securityLoading">
                  <p class="ik-ac-loading">加载中…</p>
                </template>
                <template v-else-if="!security?.hasBoundEmail">
                  <p class="ik-ac-empty">请先绑定邮箱后再设置密码。</p>
                  <z-button class="ik-ac-return-btn" @click="goBack">返回</z-button>
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
                            :disabled="codeCooldowns.password > 0 || setPasswordLoading"
                            @click="sendSetPasswordCode"
                          >
                            {{ setPasswordLoading ? '发送中' : codeCooldowns.password > 0 ? `${codeCooldowns.password}s` : '发送' }}
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

            <template v-else-if="activeSubView === 'delete'">
              <header class="ik-ac-detail-header ik-ac-detail-header--stacked">
                <button class="ik-ac-back" aria-label="返回" @click="goBack">
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <h2 class="ik-ac-detail-title">注销账号</h2>
                <div class="ik-ac-detail-spacer" />
              </header>

              <div class="ik-ac-detail-body ik-ac-detail-body--pushed">
                <div class="ik-ac-delete-warning">
                  <ExclamationTriangleIcon class="ik-ac-delete-warning__icon" aria-hidden="true" />
                  <div class="ik-ac-delete-warning__text">
                    <p class="ik-ac-delete-warning__title">注销操作不可逆</p>
                    <p class="ik-ac-delete-warning__desc">
                      注销后，账号将被永久冻结，所有设备会话立即失效。
                    </p>
                  </div>
                </div>

                <p v-if="securityLoading" class="ik-ac-loading">正在加载安全信息…</p>
                <div v-else-if="securityError" role="alert">
                  <p>{{ securityError }}</p>
                  <z-button @click="ensureSecurity(true)">重试</z-button>
                </div>
                <template v-else-if="securityLoaded">
                  <!-- 有真实邮箱：邮箱验证码核验 -->
                  <z-form v-if="!deleteNeedsScan" class="ik-ac-form" label-position="top">
                    <z-form-item label="邮箱验证码">
                      <z-input v-model="deleteCodeInput" placeholder="请输入验证码">
                        <template #append>
                          <z-button
                            class="ik-ac-code-btn"
                            :disabled="codeCooldowns.delete > 0 || deleteCodeLoading"
                            @click="sendDeleteCode"
                          >
                            {{ deleteCodeLoading ? '发送中' : codeCooldowns.delete > 0 ? `${codeCooldowns.delete}s` : '发送' }}
                          </z-button>
                        </template>
                      </z-input>
                    </z-form-item>
                    <p class="ik-ac-security-send-hint">
                      验证码将发送至你绑定的邮箱 {{ security?.email }}
                    </p>
                  </z-form>

                  <!-- 无真实邮箱（纯米游社扫码号）：重新扫码同一米游社账号核验 -->
                  <template v-else>
                    <p class="ik-ac-security-send-hint">
                      当前账号仅通过米游社扫码登录，请使用<strong>当前账号绑定的米游社账号</strong>再次扫码以核验身份
                    </p>
                    <div class="ik-ac-qr-box" :class="{ 'is-dimmed': deleteScanNeedRefresh }">
                      <img
                        v-if="deleteQrDataUrl && !deleteScanVerified"
                        :src="deleteQrDataUrl"
                        alt="米游社注销核验二维码"
                        class="ik-ac-qr"
                        draggable="false"
                      />
                      <div v-else class="ik-ac-qr-placeholder" />
                      <button
                        v-if="deleteScanNeedRefresh"
                        type="button"
                        class="ik-ac-qr-refresh"
                        @click="refreshDeleteQr"
                      >
                        刷新二维码
                      </button>
                    </div>
                    <p class="ik-ac-qr-status" :class="deleteScanVerified ? 'is-confirmed' : `is-${deleteQrStatus}`">
                      {{ deleteQrStatusText }}
                    </p>
                  </template>
                </template>

                <div class="ik-ac-form-actions">
                  <z-button
                    :icon="{ error: '#ff4444' }"
                    :disabled="deleteLoading"
                    @click="clearDeleteForm"
                  >
                    清除
                  </z-button>
                  <z-button
                    :icon="{ success: '#00cc0d' }"
                    :disabled="!securityLoaded || securityLoading || !!securityError || deleteLoading || (deleteNeedsScan ? !deleteScanVerified : !deleteCodeInput.trim())"
                    @click="handleDeleteAccount"
                  >
                    {{ deleteLoading ? '注销中…' : '确认' }}
                  </z-button>
                </div>
              </div>
            </template>
          </template>

          <!-- 设备与会话管理 -->
          <template v-else-if="activeMenuKey === 'devices'">
            <header class="ik-ac-detail-header ik-ac-detail-header--devices">
              <button v-if="isMobile" class="ik-ac-back" aria-label="返回" @click="goBack">
                <ChevronLeftIcon aria-hidden="true" />
              </button>
              <div class="ik-ac-detail-title-wrap">
                <h2 class="ik-ac-detail-title">已登录设备与会话</h2>
                <p class="ik-ac-detail-desc">以下是您近期的操作日志详情 ，若存在异常记录，建议尽快修改密码</p>
              </div>
              <div v-if="isMobile" class="ik-ac-detail-spacer" />
            </header>

            <div class="ik-ac-devices-toolbar">
              <span class="ik-ac-devices-count">
                {{ sessionsLoading ? "加载中…" : sessionsError ? "加载失败" : sessions.length ? `共 ${sessions.length} 个活跃会话` : "暂无活跃会话" }}
              </span>
              <button
                v-if="hasOtherSessions"
                type="button"
                class="ik-ac-revoke-others-btn"
                :disabled="sessionsLoading || sessionsRevoking !== null"
                @click="handleRevokeOthers"
              >
                {{ sessionsRevoking === 'others' ? '正在下线…' : '下线其他设备' }}
              </button>
            </div>

            <div class="ik-ac-detail-body">
              <template v-if="sessionsLoading && !sessions.length">
                <p class="ik-ac-loading">加载设备会话列表中…</p>
              </template>

              <template v-else-if="sessionsError">
                <div class="ik-ac-empty" role="alert">
                  <p>{{ sessionsError }}</p>
                  <z-button @click="fetchSessions(true)">重试</z-button>
                </div>
              </template>

              <template v-else-if="!sessions.length">
                <div class="ik-ac-empty">
                  <ComputerDesktopIcon class="ik-ac-empty__icon" aria-hidden="true" />
                  <span>暂无已记录的设备会话</span>
                </div>
              </template>

              <div v-else class="ik-ac-sessions-list">
                <section v-for="group in sessionGroups" :key="group.key" class="ik-ac-session-group">
                  <h3 class="ik-ac-session-group__date">{{ group.label }}</h3>
                  <ul class="ik-ac-session-group__list">
                    <li
                      v-for="item in group.items"
                      :key="item.session.id"
                      class="ik-ac-session-card"
                    >
                      <div class="ik-ac-session-card__title-row">
                        <span class="ik-ac-session-card__title">{{ item.title }}</span>
                        <span v-if="item.session.isCurrent" class="ik-ac-current-badge">当前设备</span>
                      </div>
                      <button
                        v-if="!item.session.isCurrent"
                        type="button"
                        class="ik-ac-session-card__revoke"
                        :disabled="sessionsRevoking !== null"
                        :aria-label="`下线${item.browser}设备，${item.location}，${item.ip}`"
                        @click="handleRevokeSingle(item.session)"
                      >
                        {{ sessionsRevoking === item.session.id ? '下线中…' : '下线' }}
                      </button>
                      <div class="ik-ac-session-card__meta">
                        <span class="ik-ac-session-card__browser">{{ item.browser }}</span>
                        <span class="ik-ac-session-card__separator" aria-hidden="true">|</span>
                        <span class="ik-ac-session-card__location">
                          {{ item.location }} <span class="ik-ac-session-card__ip">({{ item.ip }})</span>
                        </span>
                      </div>
                      <time
                        class="ik-ac-session-card__time"
                        :datetime="item.datetime || undefined"
                        :title="`${item.timeLabel} ${formatFullTime(item.datetime)}`"
                      >
                        <span v-if="item.timeLabel === '最近活跃'" class="ik-ac-session-card__time-label">最近活跃</span>
                        {{ item.time }}
                      </time>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </template>

          <!-- 连接 / 米游社 -->
          <template v-else-if="activeMenuKey === 'mihoyo'">
            <header class="ik-ac-detail-header">
              <button v-if="isMobile" class="ik-ac-back" aria-label="返回" @click="goBack">
                <ChevronLeftIcon aria-hidden="true" />
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
                <z-button
                  class="ik-ac-unbind-btn"
                  :disabled="mihoyoUnbinding"
                  @click="unbindMihoyo"
                >
                  {{ mihoyoUnbinding ? "解绑中…" : "解除绑定" }}
                </z-button>
                <p v-if="mihoyoOnlyAccount" class="ik-ac-security-send-hint is-warning">
                  当前账号未绑定邮箱，解绑后将无法登录。请先在「账号」中绑定邮箱，或注销当前账号。
                </p>
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
                <ChevronLeftIcon aria-hidden="true" />
              </button>
              <h2 class="ik-ac-detail-title">黑名单</h2>
              <div v-if="isMobile" class="ik-ac-detail-spacer" />
            </header>

            <div class="ik-ac-detail-body">
              <template v-if="!blockedUsers.length && blockedLoaded && !blockedLoading">
                <div class="ik-ac-empty">
                  <NoSymbolIcon class="ik-ac-empty__icon" aria-hidden="true" />
                  <span>暂无拉黑用户</span>
                </div>
              </template>

              <div v-if="blockedUsers.length" class="ik-ac-blocked-list">
                <div
                  v-for="user in blockedUsers"
                  :key="user.documentId"
                  class="ik-ac-blocked-item"
                >
                  <div class="ik-ac-blocked-avatar-wrap">
                    <img
                      :src="user.avatar || '/images/default-avatar.webp'"
                      alt=""
                      class="ik-ac-blocked-avatar"
                      @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                    />
                    <span v-if="user.level" class="ik-ac-blocked-level">{{ user.level }}</span>
                  </div>
                  <div class="ik-ac-blocked-info">
                    <span class="ik-ac-blocked-name">{{ user.name || user.username || '匿名用户' }}</span>
                  </div>
                  <button class="ik-ac-btn ik-ac-btn--small" @click="unblockUserAction(user)">
                    取消拉黑
                  </button>
                </div>
              </div>

              <p v-if="blockedLoading" class="ik-ac-loading">加载中…</p>
              <button
                v-else-if="blockedHasNext && blockedUsers.length"
                class="ik-ac-btn ik-ac-btn--ghost"
                @click="() => loadBlocked()"
              >
                加载更多
              </button>
            </div>
          </template>
          </div>
          </Transition>
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
  align-items: center;
  gap: 12px;
  min-width: 0;
  width: 100%;
}

.ik-account-menu__icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.ik-account-menu__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
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
.ik-account-menu :deep(.z-menu__item.is-active) .ik-account-menu__icon {
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

.ik-ac-section__head + .ik-ac-row {
  margin-top: 8px;
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
  margin-left: 12px;
}

.ik-ac-row__icon {
  width: 16px;
  height: 16px;
  color: #888;
  flex-shrink: 0;
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

.ik-ac-row__label--danger {
  color: #ff5252;
}

.ik-ac-row__label--danger .ik-ac-row__icon {
  color: #ff5252;
}

.ik-ac-row__value.is-danger {
  color: #ff5252;
  font-size: 13px;
}

.ik-ac-delete-warning {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 20px;
  background: rgba(255, 68, 68, 0.08);
  border: 1px solid rgba(255, 68, 68, 0.25);
  border-radius: 12px;
}

.ik-ac-delete-warning__icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: #ff5252;
  margin-top: 2px;
}

.ik-ac-delete-warning__text {
  flex: 1;
  min-width: 0;
}

.ik-ac-delete-warning__title {
  font-size: 14px;
  font-weight: 700;
  color: #ff5252;
  margin: 0 0 4px 0;
}

.ik-ac-delete-warning__desc {
  font-size: 13px;
  line-height: 1.6;
  color: #bbb;
  margin: 0;
}

.ik-ac-security-send-hint.is-warning {
  color: #ff9800;
  margin-top: 8px;
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
  background: transparent;
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

.ik-ac-detail-header--stacked {
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: 20px;
}

.ik-ac-detail-header--stacked .ik-ac-detail-spacer {
  display: none;
}

.ik-ac-detail-header--stacked .ik-ac-detail-title {
  width: 100%;
  text-align: center;
}

.ik-ac-detail-body--pushed {
  margin-top: 24px;
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
  margin-top: 20px;
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

.ik-ac-qr-status.is-retrying {
  color: #ffc14d;
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

.ik-ac-empty__icon {
  width: 40px;
  height: 40px;
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

.ik-ac-blocked-avatar-wrap {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
}

.ik-ac-blocked-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  object-fit: cover;
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
  position: absolute;
  top: -4px;
  left: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #000;
  border: 2px solid #000;
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
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

.ik-ac-unbind-btn,
.ik-ac-return-btn {
  align-self: center;
}

/* ── Misc ── */
.ik-ac-loading {
  margin: 0;
  padding: 12px 0;
  font-size: 13px;
  color: #555;
  text-align: center;
}

/* ── 设备与会话管理 ── */
.ik-ac-detail-header--devices {
  align-items: flex-start;
}

.ik-ac-detail-title-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ik-ac-detail-header--devices .ik-ac-detail-title {
  text-align: left;
}

.ik-ac-detail-desc {
  margin: 0;
  font-size: 13px;
  color: #888;
  line-height: 1.4;
}

.ik-ac-devices-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-ac-devices-count {
  font-size: 13px;
  color: #888;
  font-weight: 500;
}

.ik-ac-revoke-others-btn {
  min-height: 36px;
  padding: 6px 0 6px 8px;
  border: 0;
  background: transparent;
  color: #dca0a3;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.ik-ac-sessions-list {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: 100%;
}

.ik-ac-session-group__date {
  margin: 0 0 12px;
  padding-left: 4px;
  color: #dedee3;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
}

.ik-ac-session-group__list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ik-ac-session-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 16px;
  padding: 16px 18px;
  background: #232326;
  border-radius: 12px;
}

.ik-ac-session-card__title-row {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.ik-ac-session-card__title {
  color: #f1f1f4;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.6;
}

.ik-ac-current-badge {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(191, 255, 9, 0.09);
  color: #bfff09;
  line-height: 1.5;
  white-space: nowrap;
}

.ik-ac-session-card__meta {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
  color: #a4a4b0;
  font-size: 12px;
  line-height: 1.7;
}

.ik-ac-session-card__browser {
  white-space: nowrap;
}

.ik-ac-session-card__ip {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.ik-ac-session-card__separator {
  color: #55555f;
}

.ik-ac-session-card__location {
  overflow-wrap: anywhere;
}

.ik-ac-session-card__time {
  grid-column: 2;
  grid-row: 2;
  align-self: end;
  color: #a4a4b0;
  font-size: 12px;
  line-height: 1.7;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ik-ac-session-card__time-label {
  margin-right: 5px;
}

.ik-ac-session-card__revoke {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  min-height: 28px;
  padding: 2px 0 2px 12px;
  border: 0;
  background: transparent;
  color: #dca0a3;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ik-ac-session-card__revoke:hover,
.ik-ac-revoke-others-btn:hover {
  color: #ffb6ba;
}

.ik-ac-session-card__revoke:focus-visible,
.ik-ac-revoke-others-btn:focus-visible {
  outline: 2px solid var(--ik-primary);
  outline-offset: 4px;
}

.ik-ac-session-card__revoke:disabled,
.ik-ac-revoke-others-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .ik-ac-session-card {
    gap: 8px 12px;
    padding: 14px;
  }

  .ik-ac-session-card__time-label {
    display: block;
    margin: 0;
  }

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

.ik-ac-panel-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-height: 0;
}

.ik-ac-fade-enter-active,
.ik-ac-fade-leave-active,
.ik-ac-slide-right-enter-active,
.ik-ac-slide-right-leave-active,
.ik-ac-slide-left-enter-active,
.ik-ac-slide-left-leave-active {
  will-change: transform, opacity;
}

.ik-ac-fade-enter-active,
.ik-ac-slide-right-enter-active,
.ik-ac-slide-left-enter-active {
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 250ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-ac-fade-leave-active,
.ik-ac-slide-right-leave-active,
.ik-ac-slide-left-leave-active {
  transition: transform 200ms cubic-bezier(0.895, 0.03, 0.685, 0.22), opacity 200ms cubic-bezier(0.895, 0.03, 0.685, 0.22);
}

.ik-ac-fade-enter-from,
.ik-ac-fade-leave-to {
  opacity: 0;
}

.ik-ac-slide-right-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.ik-ac-slide-right-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

.ik-ac-slide-left-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

.ik-ac-slide-left-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .ik-ac-btn,
  .ik-ac-row,
  .ik-ac-fade-enter-active,
  .ik-ac-fade-leave-active,
  .ik-ac-slide-right-enter-active,
  .ik-ac-slide-right-leave-active,
  .ik-ac-slide-left-enter-active,
  .ik-ac-slide-left-leave-active {
    transition: none !important;
  }
}

html.no-gpu .ik-ac-fade-enter-active,
html.no-gpu .ik-ac-fade-leave-active,
html.no-gpu .ik-ac-slide-right-enter-active,
html.no-gpu .ik-ac-slide-right-leave-active,
html.no-gpu .ik-ac-slide-left-enter-active,
html.no-gpu .ik-ac-slide-left-leave-active {
  transition: none !important;
}
</style>
