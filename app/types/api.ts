export interface ApiErrorInfo {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  data: T;
  error?: ApiErrorInfo;
}

export interface Pagination<T> {
  nodes: T[];
  endCursor: string;
  hasNextPage: boolean;
  /**
   * 已读状态异步回填的 promise（仅登录态、文章列表分页会带）。
   * resolve 出本页中「已读」的文章 id 集合，供调用方在卡片渲染后
   * 再以响应式方式把已读态合并进列表，避免阻塞首屏 / 下拉加载。
   */
  readStatusReady?: Promise<Set<string>>;
}

export interface ApiClientError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}
