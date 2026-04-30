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
}

export interface ApiClientError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}
