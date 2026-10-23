/**
 * AI 工作流事件聚合（3.3）：把 WorkflowEvent 序列折算成时间线步骤视图。
 * 纯函数，供 AI 时间线、引用来源与单测复用。
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
  /** thinking | search | read | tool | limit | answer | error */
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
  /** 搜索命中数 */
  hits?: number;
  /** answer 段序号（用于把单个 AI 回复拆成多个气泡） */
  partIndex?: number;
  /** 步骤历时（ms），根据 start/finish 事件 at 字段计算 */
  durationMs?: number;
  /** 通用工具的原始名（tool.* 事件） */
  tool?: string;
  /** 检索命中的帖子（forum.search.finish 的 items，≤10） */
  items?: WorkflowPostRef[];
  /** 阅读的帖子 id（forum.read.*） */
  postId?: string;
}

/** 工具原始名 -> 时间线文案（动词短语，进行中与完成共用） */
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
  get_category_list: "浏览绳网分区",
  get_post_engagement: "查询绳网帖子互动",
  get_user_activity: "查询绳网用户动态",
};

/**
 * 时间线文案：优先用后端随事件下发的 `title`（剧情库与站外 MCP 工具，管理后台可改），
 * 其次查本地文案表，最后回落到工具名。
 */
function toolTitle(tool: string, title?: unknown): string {
  if (typeof title === "string" && title.trim()) return title.trim().slice(0, 32);
  return TOOL_TITLES[tool] ?? `使用 ${tool} 工具`;
}

/** 搜索关键词脱敏：仅展示前 24 字符，避免把长 prompt 泄进时间线 */
const clipQuery = (q: unknown): string => {
  const s = String(q ?? "").trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
};

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

  const postRefs = (raw: unknown): WorkflowPostRef[] =>
    Array.isArray(raw)
      ? raw
          .map((it) => ({
            documentId: String((it as Record<string, unknown>)?.documentId ?? ""),
            title: String((it as Record<string, unknown>)?.title ?? ""),
          }))
          .filter((it) => it.documentId)
      : [];

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
        if (ev.type === "reasoning.finish") s.status = "done";
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
        s.status = d.error === true ? "error" : "done";
        s.subtitle = clipQuery(d.query);
        s.hits = typeof d.hits === "number" ? d.hits : undefined;
        if (ts != null) touchTimestamp(s, ts);
        if (typeof d.ms === "number") s.durationMs = d.ms;
        const items = postRefs(d.items);
        if (items.length) s.items = items;
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
        if (typeof d.documentId === "string" && d.documentId) s.postId = d.documentId;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "forum.read.finish": {
        const s = upsert(ev.stepId, { kind: "read", status: "done", title: "读取绳网帖子" });
        s.status = d.error === true ? "error" : "done";
        if (typeof d.title === "string" && d.title) s.subtitle = `《${d.title}》`;
        if (typeof d.documentId === "string" && d.documentId) s.postId = d.documentId;
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "tool.start": {
        const tool = String(d.tool ?? "");
        const s = upsert(ev.stepId, {
          kind: "tool",
          status: "running",
          title: toolTitle(tool, d.title),
          tool,
        });
        if (ts != null) touchTimestamp(s, ts);
        break;
      }
      case "tool.finish": {
        const tool = String(d.tool ?? "");
        const s = upsert(ev.stepId, {
          kind: "tool",
          status: "done",
          title: toolTitle(tool, d.title),
          tool,
        });
        s.status = d.error === true ? "error" : "done";
        if (ts != null) touchTimestamp(s, ts);
        if (typeof d.ms === "number") s.durationMs = d.ms;
        break;
      }
      case "tool.limit": {
        // 工具轮数用完（WF-010）：之后模型只能基于已有结果作答
        upsert(ev.stepId, { kind: "limit", status: "done", title: "已达工具调用上限" });
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

/** 时间线是否已收束（answer.finish 或 error 之后自动折叠） */
export function isWorkflowSettled(events: AiWorkflowEvent[]): boolean {
  return events.some((ev) => ev.type === "answer.finish" || ev.type === "error");
}

/**
 * 一条 AI 回复按真实发生顺序展开成的块：连续的过程步骤（思考 / 工具）归成一组，
 * 回答分段（answer.delta）落在它出现的位置，形成「步骤 → 气泡 → 步骤 → 气泡」的穿插。
 */
export type WorkflowFlowBlock =
  | { type: "steps"; key: string; steps: WorkflowStepView[] }
  | { type: "text"; key: string; text: string; /** 还在增长的那段（流式 / 打字机） */ live: boolean };

/**
 * 把回答分段对齐到已渲染正文上：分段是后端逐段清洗过的原文，正文是整体清洗、可能还在增长的累计文本。
 * 逐段在正文里按序定位（跳过段间空白与分割线：后端在报告边界切段时把 `---` 吞掉了，正文里还留着）。
 * 生成中某段对不上（正文只露出它的前缀，或节流推送的正文落后、未闭合的 markdown 还没被清洗），
 * 露出的部分先接在这里并停下，等正文追上；回复结束后中途对不上返回 null。
 * 返回各段对应的正文和剩余未匹配的尾巴。
 */
const LEADING_RULES = /^(?:[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n|$)|\s*\n)+/;
const PART_GAP = /^(?:\s|(?:-{3,}|\*{3,}|_{3,})[ \t]*(?=\n|$))+/;
/** 末尾的分割线必须前面有空行，否则 `文字\n---` 是 setext 二级标题，不能动 */
const TRAILING_RULES = /(?:\n[ \t]*\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*)+\s*$/;

/**
 * 去掉气泡首尾的 markdown 分割线：模型常在段落之间写 `---`，分段（GEN-050 / 工具调用打断）正好切在它旁边，
 * 气泡顶上或底下就会多出一条孤零零的横线。
 */
function stripEdgeRules(text: string): string {
  return text.replace(LEADING_RULES, "").replace(TRAILING_RULES, "").trim();
}

function alignParts(
  rendered: string,
  parts: string[],
  settled: boolean,
): { texts: string[]; rest: string; partial: boolean } | null {
  const texts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = stripEdgeRules(parts[i]!);
    cursor += PART_GAP.exec(rendered.slice(cursor))?.[0].length ?? 0;
    const rest = rendered.slice(cursor);
    if (rest.startsWith(part)) {
      texts.push(part);
      cursor += part.length;
      continue;
    }
    if (!settled) {
      // 后面的段还没轮到
      if (rest.trim()) texts.push(rest.trimEnd());
      return { texts, rest: "", partial: true };
    }
    if (settled && i === parts.length - 1) {
      // 末段可能经过整体清洗 / 链接解析与原段不完全一致，用剩余正文
      texts.push(rest.trim());
      return { texts, rest: "", partial: false };
    }
    return null;
  }
  return { texts, rest: rendered.slice(cursor).trim(), partial: false };
}

/**
 * 事件序列 + 已渲染正文 → 穿插块列表。
 * - 过程步骤按首个事件的 seq 定位，回答分段按其 answer.delta 的 seq 定位；
 * - 正文里还没切成分段的部分（流式中正在写的段、或没有分段事件的旧消息）作为末尾气泡；
 * - 对齐失败时退化为「全部步骤在前、整段正文在后」。
 */
export function buildWorkflowFlow(
  events: AiWorkflowEvent[],
  rendered: string,
  opts: { settled: boolean },
): WorkflowFlowBlock[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const steps = buildWorkflowSteps(sorted);
  // 回复已结束（含用户中途停止）：没收到 finish 的步骤不再转圈
  if (opts.settled) for (const s of steps) if (s.status === "running") s.status = "done";
  const byId = new Map(steps.map((s) => [s.stepId, s]));

  type Slot = { type: "step"; step: WorkflowStepView } | { type: "part"; partIndex: number; text: string };
  const slots: Slot[] = [];
  const seenSteps = new Set<string>();
  const seenParts = new Set<number>();
  for (const ev of sorted) {
    const step = byId.get(ev.stepId);
    if (!step) continue;
    if (step.kind === "answer") {
      if (ev.type !== "answer.delta") continue;
      const partIndex = typeof ev.data?.partIndex === "number" ? ev.data.partIndex : null;
      const text = typeof ev.data?.text === "string" ? ev.data.text : "";
      if (partIndex == null || !text || seenParts.has(partIndex)) continue;
      seenParts.add(partIndex);
      slots.push({ type: "part", partIndex, text });
      continue;
    }
    if (seenSteps.has(step.stepId)) continue;
    seenSteps.add(step.stepId);
    slots.push({ type: "step", step });
  }

  const partSlots = slots.filter((s): s is Extract<Slot, { type: "part" }> => s.type === "part");
  const aligned = alignParts(rendered, partSlots.map((s) => s.text), opts.settled);

  const blocks: WorkflowFlowBlock[] = [];
  const pushStep = (step: WorkflowStepView) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === "steps") last.steps.push(step);
    else blocks.push({ type: "steps", key: `g-${step.stepId}`, steps: [step] });
  };
  const pushText = (key: string, text: string, live: boolean) => {
    const trimmed = stripEdgeRules(text);
    if (trimmed) blocks.push({ type: "text", key, text: trimmed, live });
  };

  if (!aligned) {
    for (const slot of slots) if (slot.type === "step") pushStep(slot.step);
    pushText("t-all", rendered.trim(), !opts.settled);
    return blocks;
  }

  let partCursor = 0;
  for (const slot of slots) {
    if (slot.type === "step") {
      pushStep(slot.step);
      continue;
    }
    const text = aligned.texts[partCursor];
    const isLast = partCursor === aligned.texts.length - 1;
    partCursor++;
    // 正文还没写到 / 播到这里：后面的步骤也先不出现，保持「写到哪、展示到哪」
    if (text == null) break;
    pushText(`p-${slot.partIndex}`, text, aligned.partial && isLast);
    if (aligned.partial && isLast) break;
  }
  pushText("t-tail", aligned.rest, !opts.settled);
  return blocks;
}
