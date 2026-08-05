/**
 * AI 工作流事件聚合（3.3）：把 WorkflowEvent 序列折算成时间线步骤视图。
 * 纯函数，供 AiWorkflowCard / RelatedPosts 与单测复用。
 * 事件协议见 server/src/utils/agent/workflow-events.ts。
 */
import type { AiWorkflowEvent } from "~/types/entities";

export interface WorkflowPostRef {
  documentId: string;
  title: string;
}

export type WorkflowStepStatus = "pending" | "running" | "done" | "error";

export interface WorkflowStepView {
  stepId: string;
  /** thinking | search | read | tool | answer | error */
  kind: string;
  status: WorkflowStepStatus;
  /** 主标题：如「搜索论坛」「阅读帖子」 */
  title: string;
  /** 副文案：关键词 / 帖子标题 / 耗时等 */
  subtitle?: string;
  /** reasoning/thinking 文本（可展开显示） */
  text?: string;
  /** 工具参数 / 结果（工具卡片展开用） */
  args?: unknown;
  result?: unknown;
  /** 可展开的帖子列表（搜索命中 / 已读帖子），点击可打开 postModal */
  posts?: WorkflowPostRef[];
  /** 搜索命中数 */
  hits?: number;
  /** answer 段序号（用于把单个 AI 回复拆成多个气泡） */
  partIndex?: number;
  /** 步骤历时（ms），根据 start/finish 事件 at 字段计算 */
  durationMs?: number;
}

/** 工具原始名 -> 沉浸式展示文案（会被 AiReasoningBlock 的"正在"前缀包裹） */
const TOOL_TITLES: Record<string, string> = {
  // akasha 虚空终端
  akasha_search: "检索虚空终端",
  akasha_read: "读取虚空终端档案",
  akasha_catalog: "浏览虚空终端目录",
  akasha_skill: "调用虚空终端技能",
  // 长期记忆
  recall_long_term_memory: "回忆过往记忆",
  memorize_long_term_memory: "记录重要信息",
  // 绳网论坛 MCP
  search_posts: "检索绳网",
  get_hot_posts: "查看绳网热门",
  get_user_info: "查询绳网用户",
  get_post_content: "读取绳网帖子",
  get_post_comments: "读取绳网评论",
  get_posts_by_author: "检索绳网作者帖子",
  search_posts_by_category: "按分类检索绳网",
  get_user_stats: "查询绳网用户统计",
  get_related_posts: "检索相关绳网帖子",
};

function toolTitle(tool: string): string {
  return TOOL_TITLES[tool] ?? `使用 ${tool} 工具`;
}

/** 搜索关键词脱敏：仅展示前 24 字符，避免把长 prompt 泄进时间线 */
const clipQuery = (q: unknown): string => {
  const s = String(q ?? "").trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
};

const asPosts = (v: unknown): WorkflowPostRef[] =>
  Array.isArray(v)
    ? v
        .filter(
          (it): it is { documentId: string; title: string } =>
            !!it && typeof it === "object" && typeof (it as any).documentId === "string",
        )
        .map((it) => ({ documentId: it.documentId, title: String(it.title ?? "") }))
    : [];

/** 事件序列 → 有序步骤视图（同 stepId 的 start/item/finish 聚合为一步） */
export function buildWorkflowSteps(events: AiWorkflowEvent[]): WorkflowStepView[] {
  const steps: WorkflowStepView[] = [];
  const byId = new Map<string, WorkflowStepView>();
  const bounds = new Map<string, { startedAt: number; finishedAt: number }>();

  const upsert = (stepId: string, init: Omit<WorkflowStepView, "stepId">): WorkflowStepView => {
    let step = byId.get(stepId);
    if (!step) {
      step = { stepId, ...init };
      byId.set(stepId, step);
      steps.push(step);
    }
    return step;
  };

  const touchTimestamp = (step: WorkflowStepView, ts: number) => {
    let b = bounds.get(step.stepId);
    if (!b) {
      b = { startedAt: ts, finishedAt: ts };
      bounds.set(step.stepId, b);
    } else {
      b.startedAt = Math.min(b.startedAt, ts);
      b.finishedAt = Math.max(b.finishedAt, ts);
    }
    step.durationMs = b.finishedAt - b.startedAt;
  };

  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    const d = ev.data ?? {};
    const ts = ev.at ? new Date(ev.at).getTime() : null;
    switch (ev.type) {
      case "thinking.start": {
        const s = upsert(ev.stepId, { kind: "thinking", status: "running", title: "分析问题" });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "thinking.finish": {
        const s = upsert(ev.stepId, { kind: "thinking", status: "done", title: "分析问题" });
        s.status = "done";
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "reasoning.start": {
        const s = upsert(ev.stepId, { kind: "thinking", status: "running", title: "思考" });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "reasoning.delta":
      case "reasoning.finish": {
        const s = upsert(ev.stepId, { kind: "thinking", status: ev.type === "reasoning.finish" ? "done" : "running", title: "思考" });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.search.start": {
        const s = upsert(ev.stepId, {
          kind: "search",
          status: "running",
          title: "检索绳网",
          subtitle: clipQuery(d.query),
        });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.search.finish": {
        const s = upsert(ev.stepId, { kind: "search", status: "done", title: "检索绳网" });
        s.status = "done";
        s.subtitle = clipQuery(d.query);
        s.hits = typeof d.hits === "number" ? d.hits : undefined;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.read.start": {
        const title = typeof d.title === "string" && d.title ? `《${d.title}》` : "";
        const s = upsert(ev.stepId, {
          kind: "read",
          status: "running",
          title: "读取绳网帖子",
          subtitle: title,
        });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.read.item": {
        const s = upsert(ev.stepId, { kind: "read", status: "running", title: "读取绳网帖子" });
        const title = typeof d.title === "string" && d.title ? `《${d.title}》` : "";
        if (title) s.subtitle = title;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.read.finish": {
        const s = upsert(ev.stepId, { kind: "read", status: "done", title: "读取绳网帖子" });
        s.status = "done";
        if (typeof d.title === "string" && d.title) s.subtitle = `《${d.title}》`;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "tool.start": {
        const tool = String(d.tool ?? "");
        const s = upsert(ev.stepId, {
          kind: "tool",
          status: "running",
          title: toolTitle(tool),
        });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "tool.finish": {
        const tool = String(d.tool ?? "");
        const s = upsert(ev.stepId, {
          kind: "tool",
          status: "done",
          title: toolTitle(tool),
        });
        s.status = "done";
        if (typeof d.ms === "number") s.durationMs = d.ms;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "answer.start": {
        const s = upsert(ev.stepId, { kind: "answer", status: "running", title: "生成回答" });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "answer.delta": {
        const s = upsert(ev.stepId, { kind: "answer", status: "running", title: "生成回答" });
        const text = typeof d.text === "string" ? d.text : "";
        if (text) s.text = (s.text ?? "") + text;
        if (typeof d.partIndex === "number") s.partIndex = d.partIndex;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "answer.finish": {
        const s = upsert(ev.stepId, { kind: "answer", status: "done", title: "生成回答" });
        s.status = "done";
        const text = typeof d.text === "string" ? d.text : "";
        if (text) s.text = (s.text ?? "") + text;
        if (typeof d.partIndex === "number") s.partIndex = d.partIndex;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "error": {
        // 出错：进行中的步骤全部标红，并追加错误步骤
        for (const s of steps) {
          if (s.status === "running") s.status = "error";
        }
        upsert(ev.stepId, {
          kind: "error",
          status: "error",
          title: "执行出错",
          subtitle: typeof d.message === "string" ? d.message.slice(0, 80) : undefined,
        });
        break;
      }
      default:
        // citation.add 不构成步骤；v2 预留类型（mcp.* 等）先按通用工具展示
        if (ev.type.endsWith(".start")) {
          upsert(ev.stepId, { kind: "tool", status: "running", title: ev.type });
        }
        break;
    }
  }
  return steps;
}

/** 引用资料（3.5）：citation.add 事件去重后的帖子列表 */
export function extractCitations(events: AiWorkflowEvent[]): WorkflowPostRef[] {
  const out: WorkflowPostRef[] = [];
  const seen = new Set<string>();
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    if (ev.type !== "citation.add") continue;
    const documentId = String(ev.data?.documentId ?? "");
    if (!documentId || seen.has(documentId)) continue;
    seen.add(documentId);
    out.push({ documentId, title: String(ev.data?.title ?? "") });
  }
  return out;
}

/** 推荐阅读（3.4）：搜索命中但未被引用的帖子（零额外 LLM 成本） */
export function extractRelatedPosts(events: AiWorkflowEvent[]): WorkflowPostRef[] {
  const cited = new Set(extractCitations(events).map((p) => p.documentId));
  const out: WorkflowPostRef[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "forum.search.finish") continue;
    for (const post of asPosts(ev.data?.items)) {
      if (cited.has(post.documentId) || seen.has(post.documentId)) continue;
      seen.add(post.documentId);
      out.push(post);
    }
  }
  return out;
}

/** 时间线是否已收束（answer.finish 或 error 之后自动折叠） */
export function isWorkflowSettled(events: AiWorkflowEvent[]): boolean {
  return events.some((ev) => ev.type === "answer.finish" || ev.type === "error");
}
