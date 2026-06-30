import type { ReportReason, ReportTargetType } from "~/types/entities";

export interface ReportReasonOption {
  value: ReportReason;
  label: string;
}

/** 与后端 report.reason 枚举一一对应的中文文案 */
export const REPORT_REASONS: ReportReasonOption[] = [
  { value: "spam", label: "垃圾信息 / 刷屏" },
  { value: "harassment", label: "辱骂 / 骚扰 / 人身攻击" },
  { value: "porn", label: "色情 / 低俗" },
  { value: "illegal", label: "违法违规" },
  { value: "ad", label: "广告 / 引流" },
  { value: "off_topic", label: "与版块无关" },
  { value: "other", label: "其他" },
];

export interface ReportDialogResult {
  reason: ReportReason;
  detail: string;
}

interface ReportDialogState {
  visible: boolean;
  title: string;
  targetType: ReportTargetType;
  reason: ReportReason | null;
  detail: string;
  resolve: ((value: ReportDialogResult | null) => void) | null;
}

const state = reactive<ReportDialogState>({
  visible: false,
  title: "举报",
  targetType: "article",
  reason: null,
  detail: "",
  resolve: null,
});

export function useReportDialog() {
  const open = (options: {
    targetType: ReportTargetType;
    title?: string;
  }): Promise<ReportDialogResult | null> => {
    return new Promise((resolve) => {
      state.targetType = options.targetType;
      state.title =
        options.title ||
        (options.targetType === "comment" ? "举报评论" : "举报帖子");
      state.reason = null;
      state.detail = "";
      state.resolve = resolve;
      state.visible = true;
    });
  };

  const confirm = () => {
    if (!state.reason) return;
    const result: ReportDialogResult = {
      reason: state.reason,
      detail: state.detail.trim().slice(0, 500),
    };
    state.visible = false;
    state.resolve?.(result);
    state.resolve = null;
  };

  const cancel = () => {
    state.visible = false;
    state.resolve?.(null);
    state.resolve = null;
  };

  const setReason = (reason: ReportReason) => {
    state.reason = reason;
  };

  return {
    state: readonly(state),
    open,
    confirm,
    cancel,
    setReason,
  };
}
