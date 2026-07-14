<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { watch } from "vue";
import { resolveErrorMessage } from "~/utils/api-error";
import type { BlockedUser, MihoyoBinding } from "~/types/entities";

const props = defineProps<{
  currentName?: string;
  currentBio?: string;
  currentHidden?: boolean;
  initialSub?: string;
}>();

const emit = defineEmits<{
  close: [];
  nameUpdated: [name: string];
  bioUpdated: [bio: string];
  hiddenUpdated: [hidden: boolean];
  pinnedUpdated: [pinned: string[] | null];
}>();

const route = useRoute();
const router = useRouter();
const api = useApi();
const message = useMessage();
const authStore = useAuthStore();

const modalQuery = computed(() => String(route.query.modal || ''));
const showEditName = computed(() => modalQuery.value === 'edit-name');
const showEditBio = computed(() => modalQuery.value === 'edit-bio');
const showPinned = computed(() => modalQuery.value === 'pinned');
const showSocial = computed(() => modalQuery.value === 'social');
const showBlocked = computed(() => modalQuery.value === 'blocked');
const showLogout = computed(() => modalQuery.value === 'logout');
const showMihoyo = computed(() => modalQuery.value === 'mihoyo');

const openSub = (name: string) => {
  router.replace({ query: { ...route.query, modal: name } });
};
const closeSub = () => {
  router.replace({ query: { ...route.query, modal: 'settings' } });
};

// Navigate directly to sibling modals (avatar / business card) on mobile,
// where the bottom action bar is hidden in favour of these menu entries.
const openAvatarModal = () => {
  router.replace({ query: { ...route.query, modal: 'avatar' } });
};
const openCardModal = () => {
  router.replace({ query: { ...route.query, modal: 'banner' } });
};

const nameInput = ref(props.currentName || "");
const saving = ref(false);

const bioInput = ref(props.currentBio || "");
const savingBio = ref(false);

const NAME_MAX = 20;
const BIO_MAX = 100;

const handleClose = () => {
  emit("close");
};

const logoutOption = ref('home');

const openLogout = () => {
  logoutOption.value = 'home';
  openSub('logout');
};
const closeLogout = () => {
  closeSub();
};
const confirmLogout = async () => {
  authStore.clearSession();
  emit("close");
  await router.replace("/");
};

const openEditName = () => {
  nameInput.value = props.currentName || "";
  openSub('edit-name');
};

const closeEditName = () => {
  closeSub();
};

const submitName = async () => {
  const trimmed = nameInput.value.trim();
  if (!trimmed) {
    message.warning("用户名不能为空");
    return;
  }
  if (trimmed.length > NAME_MAX) {
    message.warning(`用户名不能超过 ${NAME_MAX} 个字符`);
    return;
  }
  if (trimmed === props.currentName) {
    message.warning("什么都没改呢！");
    closeEditName();
    return;
  }
  saving.value = true;
  try {
    const result = await api.updateMyName(trimmed);
    emit("nameUpdated", result.name);
    message.success("用户名修改成功");
    closeEditName();
    handleClose();
  } catch (err) {
    message.error(resolveErrorMessage(err, "修改用户名失败"));
  } finally {
    saving.value = false;
  }
};

const openEditBio = () => {
  bioInput.value = props.currentBio || "";
  openSub('edit-bio');
};

const closeEditBio = () => {
  closeSub();
};

const submitBio = async () => {
  const trimmed = bioInput.value.trim();
  if (trimmed.length > BIO_MAX) {
    message.warning(`签名不能超过 ${BIO_MAX} 个字符`);
    return;
  }
  if (trimmed === (props.currentBio || "")) {
    message.warning("什么都没改呢！");
    closeEditBio();
    return;
  }
  savingBio.value = true;
  try {
    const result = await api.updateMyBio(trimmed);
    emit("bioUpdated", result.bio);
    message.success("签名修改成功");
    closeEditBio();
    handleClose();
  } catch (err) {
    message.error(resolveErrorMessage(err, "修改签名失败"));
  } finally {
    savingBio.value = false;
  }
};

const openPinned = () => {
  openSub('pinned');
};
const closePinned = () => {
  closeSub();
};
const onPinnedSaved = (pinned: string[] | null) => {
  emit("pinnedUpdated", pinned);
};

// ── 米游社绑定 ──────────────────────────────
const mihoyoBinding = ref<MihoyoBinding | null>(null);
const mihoyoLoading = ref(false);
const mihoyoUnbinding = ref(false);

const mihoyo = useMihoyoQr({
  isActive: () => showMihoyo.value,
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

const startMihoyoQr = mihoyo.startQr;
const stopMihoyoPolling = mihoyo.stopQr;

// 菜单按钮文案随绑定状态变化，打开设置时先拉一次绑定信息
const mihoyoMenuLabel = computed(() => (mihoyoBinding.value ? "查看米游社" : "绑定米游社"));

// 刷新绑定状态并在未绑定时启动二维码流程。
// 被 openMihoyo 和直接通过 ?modal=mihoyo 进入的场景共用。
const refreshMihoyo = async () => {
  mihoyoLoading.value = true;
  mihoyoBinding.value = null;
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

onMounted(async () => {
  if (showMihoyo.value) {
    // 直接通过 ?modal=mihoyo 进入：没有菜单 click 触发 openMihoyo，需要显式启动流程
    await refreshMihoyo();
  } else {
    try {
      mihoyoBinding.value = await api.getMihoyoBinding();
    } catch {
      // 未登录/接口失败时保持未绑定文案
    }
  }

  if (showBlocked.value) {
    blockedCursor.value = "";
    blockedHasNext.value = true;
    blockedUsers.value = [];
    await loadBlocked();
  }
});

const openMihoyo = async () => {
  openSub('mihoyo');
  await refreshMihoyo();
};

const closeMihoyo = () => {
  stopMihoyoPolling();
  closeSub();
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

const hidden = ref(!!props.currentHidden);
const togglingHidden = ref(false);

watch(
  () => props.currentHidden,
  (val) => {
    hidden.value = !!val;
  },
);

const openSocial = () => {
  hidden.value = !!props.currentHidden;
  openSub('social');
};

const closeSocial = () => {
  closeSub();
};

// z-switch 的语义是"公开"(ON=公开，OFF=隐藏)，所以需要反转
const publicSwitch = computed<boolean>({
  get: () => !hidden.value,
  set: (nextPublic) => {
    void applyVisibility(!nextPublic);
  },
});

const applyVisibility = async (nextHidden: boolean) => {
  if (togglingHidden.value) return;
  const prev = hidden.value;
  hidden.value = nextHidden; // 乐观更新
  togglingHidden.value = true;
  try {
    const result = await api.updateMyVisibility(nextHidden);
    hidden.value = result.profileHidden;
    emit("hiddenUpdated", result.profileHidden);
    message.success(result.profileHidden ? "已隐藏个人资料" : "已公开个人资料");
  } catch (err) {
    hidden.value = prev; // 回滚
    message.error(resolveErrorMessage(err, "修改失败"));
  } finally {
    togglingHidden.value = false;
  }
};

const handleSocialOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    closeSocial();
  }
};

// ── 黑名单管理 ─────────────────────────────────────────────
const blockedUsers = ref<BlockedUser[]>([]);
const blockedLoading = ref(false);
const blockedHasNext = ref(true);
const blockedCursor = ref("");

const openBlocked = () => {
  blockedCursor.value = "";
  blockedUsers.value = [];
  blockedHasNext.value = true;
  openSub('blocked');
};

const closeBlocked = () => {
  closeSub();
};

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
  }
};

watch(showBlocked, (show) => {
  if (show) {
    blockedCursor.value = "";
    blockedHasNext.value = true;
    blockedUsers.value = [];
    void loadBlocked();
  }
}, { flush: 'post' });

const unblockUser = async (user: BlockedUser) => {
  if (!user.documentId) return;
  try {
    await api.toggleUserBlock(user.documentId);
    message.success("已取消拉黑");
    blockedUsers.value = blockedUsers.value.filter((u) => u.documentId !== user.documentId);
    // 取消拉黑后让列表/搜索/个人页缓存失效，刷新后重新显示内容
    api.invalidateQueries(["articles"]);
    api.invalidateQueries(["profile"]);
  } catch (err) {
    message.error(resolveErrorMessage(err, "取消拉黑失败"));
  }
};

const handleBlockedOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    closeBlocked();
  }
};

const handleEditBioOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    closeEditBio();
  }
};

const handleOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    handleClose();
  }
};

const handleEditNameOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    closeEditName();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    if (showPinned.value) {
      // PinnedArticlesModal 内部已自行处理 Escape；此处避免冒泡到顶层
      return;
    }
    if (showLogout.value) {
      closeLogout();
    } else if (showMihoyo.value) {
      closeMihoyo();
    } else if (showBlocked.value) {
      closeBlocked();
    } else if (showSocial.value) {
      closeSocial();
    } else if (showEditBio.value) {
      closeEditBio();
    } else if (showEditName.value) {
      closeEditName();
    } else {
      handleClose();
    }
  }
};

// 如果从 URL 直接进入子弹窗，初始化对应状态
watch(
  () => props.initialSub,
  (sub) => {
    if (sub === 'edit-name') nameInput.value = props.currentName || '';
    if (sub === 'edit-bio') bioInput.value = props.currentBio || '';
    if (sub === 'social') hidden.value = !!props.currentHidden;
  },
  { immediate: true },
);

// 锁住 body 滚动，避免弹窗打开时滚轮事件穿透到下方页面
const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("profile-settings-modal");

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  acquire(SCROLL_LOCK_TOKEN);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  release(SCROLL_LOCK_TOKEN);
  stopMihoyoPolling();
});
</script>

<template>
  <div class="ik-overlay" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <div class="ik-dialog ik-dialog--settings" @click.stop>
      <div class="ik-dialog__outer">
        <div class="ik-dialog__inner">
          <!-- Header -->
          <div class="ik-dialog__header">
            <span class="ik-dialog__title">更多操作</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <!-- Menu Body -->
          <div class="ik-dialog__body">
            <IkZzzMarquee />
            <div class="ik-settings__list">
              <!-- Mobile-only: appearance actions normally living in the
                   bottom action bar on desktop. -->
              <z-button class="ik-settings__action--mobile" @click="openAvatarModal">修改头像</z-button>
              <z-button class="ik-settings__action--mobile" disabled>修改称号</z-button>
              <z-button class="ik-settings__action--mobile" disabled>修改勋章</z-button>
              <z-button class="ik-settings__action--mobile" @click="openCardModal">修改名片</z-button>
              <z-button @click="openEditName">修改用户名</z-button>
              <z-button @click="openEditBio">修改签名</z-button>
              <z-button @click="openPinned">修改委托展示</z-button>
              <z-button @click="openSocial">社交设置</z-button>
              <z-button @click="openBlocked">黑名单管理</z-button>
              <z-button @click="openMihoyo">{{ mihoyoMenuLabel }}</z-button>
              <z-button @click="openLogout">退出登录</z-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Name Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showEditName" class="ik-overlay ik-overlay--sub" @click="handleEditNameOverlayClick">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">修改用户名</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeEditName">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-edit-name__wrapper">
                    <div class="ik-edit-name">
                      <div class="ik-edit-name__field">
                        <z-input
                          v-model="nameInput"
                          :maxlength="NAME_MAX"
                          placeholder="请输入新用户名"
                          :disabled="saving"
                          clearable
                          @keydown.enter="submitName"
                        />
                      </div>
                      <div class="ik-edit-name__meta">
                        <span class="ik-edit-name__count">{{ nameInput.trim().length }}/{{ NAME_MAX }}</span>
                        <div class="ik-edit-name__cost">
                          <span class="ik-edit-name__cost-amount">10</span>
                          <img src="/images/materials/dennies_v2.webp" alt="Dennies" class="ik-edit-name__cost-img" draggable="false" />
                        </div>
                      </div>
                    </div>
                    <z-button
                      class="ik-edit-name__submit"
                      :icon="{ success: '#00cc0d' }"
                      :disabled="saving || !nameInput.trim()"
                      @click="submitName"
                    >
                      {{ saving ? '保存中...' : '确定' }}
                    </z-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    <!-- Edit Bio Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showEditBio" class="ik-overlay ik-overlay--sub" @click="handleEditBioOverlayClick">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">修改签名</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeEditBio">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-edit-name__wrapper">
                    <div class="ik-edit-name">
                      <div class="ik-edit-name__field">
                        <z-textarea
                          v-model="bioInput"
                          :maxlength="BIO_MAX"
                          placeholder="请输入新签名"
                          :disabled="savingBio"
                        />
                      </div>
                      <div class="ik-edit-name__meta">
                        <span class="ik-edit-name__count">{{ bioInput.trim().length }}/{{ BIO_MAX }}</span>
                      </div>
                    </div>
                    <z-button
                      class="ik-edit-name__submit"
                      :icon="{ success: '#00cc0d' }"
                      :disabled="savingBio"
                      @click="submitBio"
                    >
                      {{ savingBio ? '保存中...' : '确定' }}
                    </z-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Social Settings Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showSocial" class="ik-overlay ik-overlay--sub" @click="handleSocialOverlayClick">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog ik-dialog--large" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">社交设置</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeSocial">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-social">
                    <div class="ik-social__row">
                      <div class="ik-social__text">
                        <span class="ik-social__label">公开个人资料</span>
                        <span class="ik-social__desc">
                          关闭后，其他用户访问你的主页将无法看到签名、统计数据、名片和发过的委托/评论。
                        </span>
                      </div>
                      <z-switch
                        v-model="publicSwitch"
                        :disabled="togglingHidden"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Blocked Users Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showBlocked" class="ik-overlay ik-overlay--sub" @click="handleBlockedOverlayClick">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog ik-dialog--large" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">黑名单管理</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeBlocked">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-blocked-list">
                    <template v-if="!blockedUsers.length && !blockedLoading">
                      <div class="ik-blocked-list__empty">暂无拉黑用户</div>
                    </template>
                    <div
                      v-for="user in blockedUsers"
                      :key="user.documentId"
                      class="ik-blocked-list__item"
                    >
                      <img
                        :src="user.avatar || '/images/default-avatar.webp'"
                        alt=""
                        class="ik-blocked-list__avatar"
                        @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                      />
                      <div class="ik-blocked-list__info">
                        <span class="ik-blocked-list__name">{{ user.name || user.username || '匿名用户' }}</span>
                        <span v-if="user.level" class="ik-blocked-list__level">Lv.{{ user.level }}</span>
                      </div>
                      <z-button size="small" @click="unblockUser(user)">取消拉黑</z-button>
                    </div>

                    <div v-if="blockedLoading" class="ik-blocked-list__loading">加载中…</div>
                    <z-button
                      v-else-if="blockedHasNext"
                      size="small"
                      @click="loadBlocked"
                    >
                      加载更多
                    </z-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Mihoyo Binding Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showMihoyo" class="ik-overlay ik-overlay--sub" @click.self="closeMihoyo">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog ik-dialog--mihoyo" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">米游社绑定</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeMihoyo">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-mihoyo">
                    <template v-if="mihoyoLoading">
                      <p class="ik-mihoyo__status">加载中…</p>
                    </template>
                    <template v-else-if="mihoyoBinding">
                      <div class="ik-mihoyo__info">
                        <div class="ik-mihoyo__row">
                          <span class="ik-mihoyo__label">名称</span>
                          <span class="ik-mihoyo__value">{{ mihoyoBinding.zzzNickname || "未获取到角色" }}</span>
                        </div>
                        <div v-if="mihoyoBinding.zzzUid" class="ik-mihoyo__row">
                          <span class="ik-mihoyo__label">UID</span>
                          <span class="ik-mihoyo__value">{{ mihoyoBinding.zzzUid }}</span>
                        </div>
                        <div v-if="mihoyoBinding.zzzLevel != null" class="ik-mihoyo__row">
                          <span class="ik-mihoyo__label">等级</span>
                          <span class="ik-mihoyo__value">Lv.{{ mihoyoBinding.zzzLevel }}</span>
                        </div>
                        <div v-if="mihoyoBinding.zzzRegionName" class="ik-mihoyo__row">
                          <span class="ik-mihoyo__label">服务器</span>
                          <span class="ik-mihoyo__value">{{ mihoyoBinding.zzzRegionName }}</span>
                        </div>
                      </div>
                      <z-button
                        :icon="{ error: '#ff4444' }"
                        :disabled="mihoyoUnbinding"
                        @click="unbindMihoyo"
                      >
                        {{ mihoyoUnbinding ? "解绑中…" : "解除绑定" }}
                      </z-button>
                    </template>
                    <template v-else>
                      <div class="ik-mihoyo__qr-box" :class="{ 'is-dimmed': mihoyoQrNeedRefresh }">
                        <img
                          v-if="mihoyoQrDataUrl"
                          :src="mihoyoQrDataUrl"
                          alt="米游社绑定二维码"
                          class="ik-mihoyo__qr"
                          draggable="false"
                        />
                        <div v-else class="ik-mihoyo__qr-placeholder" />
                        <button
                          v-if="mihoyoQrNeedRefresh"
                          type="button"
                          class="ik-mihoyo__refresh"
                          @click="startMihoyoQr"
                        >
                          刷新二维码
                        </button>
                      </div>
                      <p class="ik-mihoyo__status" :class="`is-${mihoyoQrStatus}`">
                        {{ mihoyoQrStatusText }}
                      </p>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Pinned Articles Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <PinnedArticlesModal
          v-if="showPinned"
          @close="closePinned"
          @saved="onPinnedSaved"
        />
      </Transition>
    </Teleport>

    <!-- Logout Sub-dialog -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <div v-if="showLogout" class="ik-overlay ik-overlay--sub" @click.self="closeLogout">
          <div class="ik-overlay__stripe" aria-hidden="true"></div>
          <div class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">退出登录</span>
                  <button class="ik-dialog__close" aria-label="关闭" @click="closeLogout">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <IkZzzMarquee />
                  <div class="ik-logout__wrapper">
                    <div class="ik-logout__inner">
                      <div class="ik-logout__options">
                        <z-radio v-model="logoutOption" value="home">返回首页并清除登录记录</z-radio>
                      </div>
                    </div>
                    <div class="ik-logout__actions">
                      <z-button :icon="{ error: '#ff4444' }" @click="closeLogout">取消</z-button>
                      <z-button :icon="{ success: '#00cc0d' }" @click="confirmLogout">确定</z-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay — 与委托弹窗 / 登录弹窗完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9100;
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
  width: 450px;
  max-width: 90%;
  height: 300px;
  max-height: 90%;
  will-change: transform;
}

.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  height: 100%;
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

.ik-settings__list {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
  box-sizing: border-box;
}

.ik-settings__list :deep(.z-button) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin-left: 0;
  padding: 12px 10px;
  font-size: 13px;
  line-height: 1.2;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 奇数个按钮时最后一项独占一行，避免右侧空白 */
.ik-settings__list > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

/* Appearance actions live in the bottom action bar on desktop, so
   suppress them in the menu by default. */
.ik-settings__action--mobile {
  display: none;
}

/* ── Logout sub-dialog ── */
.ik-logout__wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.ik-logout__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 120px 24px 45px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}
.ik-logout__options {
  position: absolute;
  top: 24px;
  left: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ik-logout__actions {
  display: flex;
  gap: 12px;
  margin-top: -18px;
  position: relative;
  z-index: 1;
}

/* ── Larger dialog variant (for settings pages) ── */
.ik-dialog--large {
  width: 50%;
  height: 60%;
}

@media (max-width: 800px) {
  .ik-dialog--large {
    width: 92%;
    height: 85%;
  }
}

@media (max-width: 500px) {
  .ik-dialog--large {
    width: 100%;
    height: 95%;
  }
}
/* body 改为顶部对齐，方便未来放多项设置 */
.ik-dialog--large .ik-dialog__body {
  align-items: stretch;
  justify-content: flex-start;
  padding: 20px;
  overflow-y: auto;
}

/* ── Social Settings ─────────────────────────── */
.ik-social {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin: 0 auto;
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-social__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.ik-social__row:last-child {
  border-bottom: none;
}

.ik-social__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.ik-social__label {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.ik-social__desc {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
}

/* ── Edit Name Form ───────────────────────────── */
.ik-edit-name {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  padding: 32px 20px 45px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-edit-name__field {
  position: relative;
}

.ik-edit-name__field :deep(.z-input) {
  width: 100%;
}

.ik-edit-name__meta {
  display: flex;
  justify-content: flex-end; /* 靠右侧对齐，使信息统一在右下角收束 */
  align-items: center;
  gap: 8px; /* 缩窄字数与费用的间距，使其靠得更近 */
  margin-top: -6px;
  width: 100%;
}

.ik-edit-name__cost {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ik-edit-name__cost-amount {
  font-size: 12px; /* 调小至 12px，与字数统计（12px）完全等大对齐 */
  font-weight: 700;
  color: var(--ik-primary);
}

.ik-edit-name__cost-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.ik-edit-name__count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

.ik-edit-name__wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ik-edit-name__wrapper > :deep(.z-button) {
  margin-top: -18px;
  position: relative;
  z-index: 1;
  min-width: 70px;
}

/* 入场/出场动画统一在 theme.css 的 .ik-overlay-* 全局规则里维护 */

/* ── Sub-overlay z-index boost ────────────────── */
.ik-overlay--sub {
  z-index: 9200;
}

/* Settings dialog now has 7+ entries (up to 11 on mobile); let it size
   to content and scroll when it hits the viewport, instead of clipping
   against the fixed 300px height. */
.ik-dialog--settings {
  height: auto;
  max-height: 90%;
}

.ik-dialog--settings .ik-dialog__body {
  overflow-y: auto;
  align-items: flex-start;
}

/* ── Mobile / Portrait — show appearance actions in the menu ─── */
@media (max-width: 1023px), (orientation: portrait) {
  .ik-settings__action--mobile {
    display: inline-flex;
  }
}

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
  /* Keep the ZZZ-style 3-rounded-corner frame on mobile; sub-dialogs
     (edit name / bio / social / logout) are centered popups, not
     fullscreen sheets. */
}

/* ── 米游社绑定 ─────────────────────────────────── */
.ik-dialog--mihoyo {
  height: auto;
  min-height: 300px;
}

.ik-mihoyo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  width: 100%;
}

.ik-mihoyo__qr-box {
  position: relative;
  width: 180px;
  height: 180px;
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

.ik-mihoyo__info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 320px;
  padding: 14px 18px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 12px;
}

.ik-mihoyo__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.ik-mihoyo__label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

.ik-mihoyo__value {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  text-align: right;
  word-break: break-all;
}

/* ── 黑名单管理 ─────────────────────────────────── */
.ik-blocked-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 12px 0;
}

.ik-blocked-list__empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
  padding: 40px 0;
}

.ik-blocked-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 10px;
}

.ik-blocked-list__avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
}

.ik-blocked-list__info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ik-blocked-list__name {
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-blocked-list__level {
  color: #bfff09;
  font-size: 12px;
  font-weight: 700;
}

/* prefers-reduced-motion 由 theme.css 全局接管 */
</style>
