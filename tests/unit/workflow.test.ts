import { describe, expect, it } from "vitest";
import type { AiWorkflowEvent } from "~/types/entities";
import {
  buildWorkflowSteps,
  extractCitations,
  extractRelatedPosts,
  isWorkflowSettled,
} from "~/utils/workflow";

/** 便捷构造：seq 按数组顺序自增 */
const evs = (
  list: Array<Pick<AiWorkflowEvent, "type" | "stepId"> & { data?: Record<string, unknown> }>,
): AiWorkflowEvent[] =>
  list.map((it, i) => ({
    type: it.type,
    stepId: it.stepId,
    seq: i + 1,
    at: 1700000000000 + i,
    ...(it.data ? { data: it.data } : {}),
  }));

describe("buildWorkflowSteps 步骤聚合", () => {
  it("同 stepId 的 start/finish 聚合为一步并推进状态", () => {
    const steps = buildWorkflowSteps(
      evs([
        { type: "thinking.start", stepId: "s1" },
        { type: "thinking.finish", stepId: "s1" },
        { type: "forum.search.start", stepId: "s2", data: { query: "绳网热梗" } },
      ]),
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ kind: "thinking", status: "done" });
    expect(steps[1]).toMatchObject({ kind: "search", status: "running", subtitle: "绳网热梗" });
  });

  it("search.finish 记录命中数与帖子列表；read.item 收集已读帖子", () => {
    const steps = buildWorkflowSteps(
      evs([
        { type: "forum.search.start", stepId: "s1", data: { query: "q" } },
        {
          type: "forum.search.finish",
          stepId: "s1",
          data: { query: "q", hits: 7, items: [{ documentId: "a1", title: "帖子A" }] },
        },
        { type: "forum.read.start", stepId: "s2", data: { documentId: "a1" } },
        { type: "forum.read.item", stepId: "s2", data: { documentId: "a1", title: "帖子A" } },
        { type: "forum.read.finish", stepId: "s2", data: { documentId: "a1", title: "帖子A" } },
      ]),
    );
    expect(steps[0]!.hits).toBe(7);
    expect(steps[0]!.posts).toEqual([{ documentId: "a1", title: "帖子A" }]);
    expect(steps[1]).toMatchObject({ kind: "read", status: "done", subtitle: "《帖子A》" });
    expect(steps[1]!.posts).toEqual([{ documentId: "a1", title: "帖子A" }]);
  });

  it("乱序事件按 seq 重排后聚合", () => {
    const shuffled = evs([
      { type: "answer.start", stepId: "s1" },
      { type: "answer.finish", stepId: "s1" },
    ]).reverse();
    const steps = buildWorkflowSteps(shuffled);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe("done");
  });

  it("error 事件把运行中的步骤标红并追加错误步骤", () => {
    const steps = buildWorkflowSteps(
      evs([
        { type: "forum.search.start", stepId: "s1", data: { query: "q" } },
        { type: "error", stepId: "s2", data: { message: "上游超时" } },
      ]),
    );
    expect(steps[0]!.status).toBe("error");
    expect(steps[1]).toMatchObject({ kind: "error", status: "error", subtitle: "上游超时" });
  });

  it("搜索关键词超 24 字符脱敏截断", () => {
    const long = "一".repeat(30);
    const steps = buildWorkflowSteps(
      evs([{ type: "forum.search.start", stepId: "s1", data: { query: long } }]),
    );
    expect(steps[0]!.subtitle).toBe(`${"一".repeat(24)}…`);
  });

  it("citation.add 不构成步骤；未知 .start 类型按通用工具兜底", () => {
    const steps = buildWorkflowSteps(
      evs([
        { type: "citation.add", stepId: "s1", data: { documentId: "a1", title: "T" } },
        { type: "mcp.start", stepId: "s2" },
      ]),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "tool", status: "running", title: "mcp.start" });
  });
});

describe("extractCitations / extractRelatedPosts", () => {
  const events = evs([
    {
      type: "forum.search.finish",
      stepId: "s1",
      data: {
        query: "q",
        hits: 3,
        items: [
          { documentId: "a1", title: "被引用" },
          { documentId: "a2", title: "未引用" },
          { documentId: "a3", title: "推荐B" },
        ],
      },
    },
    { type: "citation.add", stepId: "s2", data: { documentId: "a1", title: "被引用" } },
    { type: "citation.add", stepId: "s2", data: { documentId: "a1", title: "重复引用" } },
    { type: "answer.finish", stepId: "s3" },
  ]);

  it("citation.add 按 documentId 去重", () => {
    expect(extractCitations(events)).toEqual([{ documentId: "a1", title: "被引用" }]);
  });

  it("推荐阅读 = 搜索命中减去已引用（3.4 零额外成本）", () => {
    expect(extractRelatedPosts(events)).toEqual([
      { documentId: "a2", title: "未引用" },
      { documentId: "a3", title: "推荐B" },
    ]);
  });
});

describe("isWorkflowSettled 收束判定", () => {
  it("answer.finish 或 error 后为已收束", () => {
    expect(isWorkflowSettled(evs([{ type: "answer.finish", stepId: "s1" }]))).toBe(true);
    expect(isWorkflowSettled(evs([{ type: "error", stepId: "s1" }]))).toBe(true);
  });

  it("仅有进行中事件时未收束", () => {
    expect(isWorkflowSettled(evs([{ type: "answer.start", stepId: "s1" }]))).toBe(false);
    expect(isWorkflowSettled([])).toBe(false);
  });
});
