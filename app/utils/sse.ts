/**
 * 浏览器侧 SSE 解析（基于 fetch + ReadableStream）
 *
 * 为什么不用 EventSource：
 *  - EventSource 不能加 Authorization header
 *  - EventSource 只支持 GET
 *  - 我们的 SSE 接口（如 KKCall chat）是 POST + 需要 Bearer token
 *
 * 用法：
 * ```ts
 * for await (const evt of fetchSSE(url, { method: "POST", body, signal, token })) {
 *   if (evt.type === "message.delta") { ... }
 * }
 * ```
 *
 * 协议假设（与后端 makeSseWriter 配套）：
 *  - 每个事件块以双换行结束
 *  - 事件块包含 0..n 行 `event: <type>` 与 0..n 行 `data: <json|string>`
 *  - 多行 data 按 `\n` join（标准 SSE）
 *  - 行首 `:` 为注释，忽略
 */

export interface SseEvent<TData = unknown> {
  type: string;
  /** 已尝试 JSON.parse；解析失败时为原始字符串 */
  data: TData;
}

export interface FetchSSEOptions {
  method?: "GET" | "POST";
  /** 请求体；string 或 plain object（自动 JSON.stringify） */
  body?: unknown;
  /** Bearer token；若提供则自动加 Authorization header */
  token?: string;
  /** 额外 header（会与默认 header 合并） */
  headers?: Record<string, string>;
  /** 用于取消请求 */
  signal?: AbortSignal;
}

/**
 * 发起 SSE 请求并产生事件迭代器。
 * 抛出场景：网络失败 / HTTP 非 2xx / 响应不是 stream。
 */
export async function* fetchSSE<TData = unknown>(
  url: string,
  options: FetchSSEOptions = {},
): AsyncGenerator<SseEvent<TData>, void, void> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...(options.headers || {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body: BodyInit | undefined;
  if (options.body != null) {
    if (typeof options.body === "string") {
      body = options.body;
    } else {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(options.body);
    }
  }

  const resp = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
    signal: options.signal,
    // SSE 不需要 cookie；保持默认即可。如要发送同站 cookie，由调用方传 headers
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: Error & { status?: number; body?: string } = new Error(
      `SSE HTTP ${resp.status}: ${text.slice(0, 200) || resp.statusText}`,
    );
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  if (!resp.body) {
    throw new Error("SSE response has no body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 标准 SSE 帧分隔：\n\n（容忍 \r\n\r\n）
      let sepIdx: number;
      while ((sepIdx = findFrameEnd(buffer)) >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx).replace(/^(\r?\n){2}/, "");
        const parsed = parseFrame<TData>(frame);
        if (parsed) yield parsed;
      }
    }
    // flush 残余（理论上结束时应该有完整帧；为了健壮性兜底一次）
    if (buffer.trim()) {
      const parsed = parseFrame<TData>(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

function findFrameEnd(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a < 0 && b < 0) return -1;
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

function parseFrame<TData>(frame: string): SseEvent<TData> | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
    // id: / retry: 暂不需要
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join("\n");
  let data: any;
  try {
    data = JSON.parse(dataStr);
  } catch {
    data = dataStr;
  }
  return { type, data: data as TData };
}
