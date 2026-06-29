const _active = ref(false);
const _progress = ref(0);
const _claimed = ref(false);
let _interval: ReturnType<typeof setInterval> | null = null;
let _fadeTimer: ReturnType<typeof setTimeout> | null = null;

function _clearTimers() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  if (_fadeTimer) {
    clearTimeout(_fadeTimer);
    _fadeTimer = null;
  }
}

function _startTicking() {
  // 进度条纯客户端视觉，服务端不启动定时器（避免 SSR setInterval 泄漏告警）。
  if (!import.meta.client) return;
  if (_interval) return;
  _interval = setInterval(() => {
    _progress.value += (90 - _progress.value) * 0.1;
  }, 150);
}

export const usePageDataLoading = () => {
  /** Begin a new progress bar (called on route navigation start). */
  const start = () => {
    if (!import.meta.client) return;
    _clearTimers();
    _claimed.value = false;
    _active.value = true;
    _progress.value = 10;
    _startTicking();
  };

  /** Page claims the loading bar — prevents auto-finish after route completes. */
  const claim = () => {
    _claimed.value = true;
  };

  /** Complete the progress bar with a fill-to-100% animation. */
  const finish = () => {
    // 进度条纯客户端视觉，服务端不启动定时器（避免 SSR setTimeout 泄漏）。
    if (!import.meta.client) return;
    _clearTimers();
    _claimed.value = false;
    _progress.value = 100;
    _fadeTimer = setTimeout(() => {
      _active.value = false;
      _progress.value = 0;
    }, 350);
  };

  return {
    isActive: readonly(_active),
    progress: readonly(_progress),
    isClaimed: readonly(_claimed),
    start,
    claim,
    finish,
  };
};
