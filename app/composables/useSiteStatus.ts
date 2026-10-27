/**
 * useSiteStatus —— 站点公告与只读维护状态（后台「系统设置」里配置，`GET /v1/site`）。
 *
 * 页面加载时拉一次，之后每 5 分钟、以及标签页重新可见时再拉；写操作碰到 503 `READ_ONLY`
 * 时立即刷新（plugins/api.ts 广播 `site:read-only`），让横幅马上出现。
 * 用户关掉的公告按 id 记在本机，内容或链接一改 id 就变，会重新出现。
 */
export interface SiteAnnouncement {
  id: string;
  text: string;
  link?: string | null;
  tone: "info" | "warning";
  endsAt?: string | null;
}

export interface SiteStatus {
  announcement: SiteAnnouncement | null;
  readOnly: { message: string } | null;
}

const DISMISSED_KEY = "ik:dismissed-announcement";
const REFRESH_MS = 5 * 60 * 1000;

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) || "";
  } catch {
    return "";
  }
}

export function useSiteStatus() {
  const status = useState<SiteStatus | null>("site-status", () => null);
  const dismissed = useState<string>("site-status-dismissed", () => "");

  const announcement = computed(() => {
    const a = status.value?.announcement;
    if (!a || a.id === dismissed.value) return null;
    if (a.endsAt && new Date(a.endsAt).getTime() <= Date.now()) return null;
    return a;
  });
  const readOnly = computed(() => status.value?.readOnly ?? null);

  function dismiss() {
    const id = status.value?.announcement?.id;
    if (!id) return;
    dismissed.value = id;
    try {
      localStorage.setItem(DISMISSED_KEY, id);
    } catch {
      // 隐私模式等存不了：只在本次打开期间不显示。
    }
  }

  return { status, announcement, readOnly, dismiss, readDismissed, dismissed };
}

/** 由 plugins/site-status.client.ts 调用：拉取并定时刷新。 */
export function startSiteStatus(fetcher: () => Promise<SiteStatus>) {
  const { status, dismissed, readDismissed } = useSiteStatus();
  dismissed.value = readDismissed();
  let inflight: Promise<void> | null = null;
  const refresh = () => {
    inflight ??= fetcher()
      .then((next) => {
        status.value = next;
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  void refresh();
  window.setInterval(refresh, REFRESH_MS);
  // 标签页重新可见：由 cache-revalidation.client.ts 统一派发。
  window.addEventListener("ik:tab-visible", () => void refresh());
  window.addEventListener("site:read-only", () => void refresh());
  return refresh;
}
