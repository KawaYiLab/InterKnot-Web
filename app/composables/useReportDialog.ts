export type ReportTargetType = "article" | "comment" | "user";

export interface ReportReasonOption {
  value: string;
  label: string;
}

export const REPORT_REASON_OPTIONS: ReportReasonOption[] = [
  { value: "spam", label: "垃圾广告 / 刷屏" },
  { value: "abuse", label: "辱骂攻击 / 引战" },
  { value: "porn", label: "色情低俗" },
  { value: "illegal", label: "违法违规" },
  { value: "privacy", label: "泄露隐私" },
  { value: "misinfo", label: "不实信息" },
  { value: "plagiarism", label: "抄袭搬运" },
  { value: "other", label: "其他" },
];

interface ReportDialogState {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  /** 弹窗标题里展示的目标描述，如「帖子」「评论」「用户 xxx」 */
  targetLabel: string;
  resolve: ((submitted: boolean) => void) | null;
}

const state = reactive<ReportDialogState>({
  visible: false,
  targetType: "article",
  targetId: "",
  targetLabel: "",
  resolve: null,
});

export function useReportDialog() {
  const open = (options: {
    targetType: ReportTargetType;
    targetId: string;
    targetLabel?: string;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      state.targetType = options.targetType;
      state.targetId = options.targetId;
      state.targetLabel =
        options.targetLabel ||
        (options.targetType === "article"
          ? "帖子"
          : options.targetType === "comment"
            ? "评论"
            : "用户");
      state.resolve = resolve;
      state.visible = true;
    });
  };

  const close = (submitted: boolean) => {
    state.visible = false;
    state.resolve?.(submitted);
    state.resolve = null;
  };

  return {
    state: readonly(state),
    open,
    close,
  };
}
