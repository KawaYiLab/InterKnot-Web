/**
 * DM 消息视图层共享类型与纯函数（Phase 4 拆分）：
 * KnockKnockModal（容器）与 DmMessageItem（展示组件）共用，
 * 数据仍由 useDmConversations 单源提供，这里只放派生视图约定。
 */
import type { AiWorkflowEvent, DmMessage } from "~/types/entities";
import type { WorkflowPostRef } from "~/utils/workflow";

/**
 * 气泡正文如何渲染：
 *  - 字符串：直接 {{ }} 出
 *  - { mode: "rich", content } → 走 <CommentBody>（通知里的评论原文 @mention 高亮）
 */
export type BubbleRender = string | { mode: "rich"; content: string };

// ── AI 回复内链接渲染（markdown 链接 + 裸 /post/xxx 路径均可点击）──
export type BubbleSegment =
  | { type: "text"; content: string }
  | { type: "link"; text: string; href: string };

// 匹配 markdown 链接 [text](url) 或裸路径 /post/documentId
const BUBBLE_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)|\/post\/([a-zA-Z0-9_-]+)/g;

export const hasBubbleLinks = (text: string): boolean =>
  /\[([^\]]+)\]\(([^)]+)\)|\/post\/[a-zA-Z0-9_-]+/.test(text);

export const parseBubbleSegments = (text: string): BubbleSegment[] => {
  const regex = new RegExp(BUBBLE_LINK_RE.source, "g");
  const segments: BubbleSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    if (match[1] && match[2]) {
      // markdown link: [text](url)
      segments.push({ type: "link", text: match[1], href: match[2] });
    } else if (match[3]) {
      // bare /post/id path → 显示为"查看委托"标签
      segments.push({ type: "link", text: "查看委托", href: `/post/${match[3]}` });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
};

/**
 * 一次性把每条消息的派生信息算好——避免 template v-for 内重复调用
 * isMine / bubbleText / shouldShowQuote / quoteLabel / quoteTitle 等函数。
 * 由 KnockKnockModal 的 enrichedMessages computed 生产，DmMessageItem 消费。
 */
export interface EnrichedMessage {
  msg: DmMessage;
  isMine: boolean;
  isNew: boolean;
  showTime: boolean;
  rendered: BubbleRender;
  /** AI 会话中对方的 text 消息 → 走 AiMessageBody 富文本（markdown）渲染 */
  aiRich: boolean;
  /** 流式接收中或打字机播放中：AiMessageBody 显示光标并跳过代码高亮 */
  aiStreaming: boolean;
  /** 流式占位（首个 delta 未到）：气泡显示"正在输入"加载点 */
  pendingStream: boolean;
  /** AI 工作流事件（3.3）：落库回放优先，其次实时推送缓存；气泡上方渲染时间线卡 */
  workflowEvents: AiWorkflowEvent[];
  /** 引用帖子（3.5）：最终回答里出现过的 /post/xxx 去重列表 */
  citations: WorkflowPostRef[];
  /** 推荐阅读（3.4）：回答定稿后，搜索命中但未被引用的帖子 */
  relatedPosts: WorkflowPostRef[];
  /** 气泡 hover 操作条可复制（1.4）：未撤回的非空文本消息 */
  copyable: boolean;
  quote: {
    label: string;
    title: string;
    article: NonNullable<DmMessage["article"]>;
  } | null;
  /** 头像是否可点击跳转个人主页 */
  avatarClickable: boolean;
  /** 个人主页 URL（avatarClickable 为 false 时为 null） */
  profileUrl: string | null;
}
