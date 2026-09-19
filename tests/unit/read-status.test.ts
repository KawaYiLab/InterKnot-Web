import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/vue-query";
import { isReadonly } from "vue";
import { useApi } from "~/composables/useApi";
import type { Pagination } from "~/types/api";
import type { Post } from "~/types/entities";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const rawPost = { documentId: "read-post", title: "Read post", isRead: false };
const rawPage = () => ({
  data: [{ ...rawPost }],
  meta: { pagination: { start: 0, limit: 20, total: 1, pageCount: 1 } },
});

let queryClient: QueryClient;
let api: ReturnType<typeof useApi>;
const transport = vi.fn();

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  transport.mockReset();
  vi.stubGlobal("useNuxtApp", () => ({ $api: transport, $queryClient: queryClient }));
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiBaseUrl: "https://api.example.test" } }));
  vi.stubGlobal("useAuthStore", () => ({ ensureCredentials: async () => {} }));
  api = useApi();
  api.clearAllCache();
});

afterEach(() => {
  api.clearAllCache();
  vi.unstubAllGlobals();
});

const consumers = [
  {
    name: "home list",
    key: ["articles", "search", "", "", 0, 20, "latest"],
    load: () => api.searchArticles(""),
    peek: () => api.peekArticles(""),
    response: rawPage,
  },
  {
    name: "search results",
    key: ["articles", "search", "query", "", 0, 20, "latest"],
    load: () => api.searchArticles("query"),
    peek: () => api.peekArticles("query"),
    response: rawPage,
  },
  {
    name: "profile articles",
    key: ["profile", "reader", "articles", 0, 20],
    load: () => api.getProfileArticles("reader"),
    peek: undefined,
    response: rawPage,
  },
  {
    name: "post detail",
    key: ["articles", "detail", "read-post"],
    load: () => api.getPost("read-post"),
    peek: undefined,
    response: () => ({ data: { ...rawPost } }),
  },
];

const firstPost = (result: Post | Pagination<Post>) => "nodes" in result ? result.nodes[0]! : result;

describe("confirmed read status", () => {
  it.each(consumers)("keeps $name read when TanStack writes an older response after the mark", async ({ key, load, peek, response }) => {
    transport.mockResolvedValue(response());
    const initial = await load();
    expect(firstPost(initial).isRead).toBe(false);

    const listResponse = deferred<ReturnType<typeof response>>();
    const readResponse = deferred<void>();
    transport.mockImplementation((path: string) => path === "/api/article-reads/batch"
      ? readResponse.promise
      : listResponse.promise);
    const cacheChanges: boolean[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const data = event.query.state.data as Post | Pagination<Post> | undefined;
      if (event.type === "updated" && data) cacheChanges.push(!!firstPost(data).isRead);
    });
    api.invalidateQueries(key);
    const reload = load();
    // The list waits for credentials before starting its query. Let that
    // continuation run before settling the two independent network calls.
    await Promise.resolve();
    const marking = api.markAsReadBatch(["read-post"]);
    listResponse.resolve(response());
    readResponse.resolve();
    const [result] = await Promise.all([reload, marking]);
    unsubscribe();

    // Real TanStack structural sharing writes the old result after the mark's
    // immutable cache update. Consumers must merge after fetchQuery resolves.
    expect(cacheChanges).toContain(true);
    expect(firstPost(queryClient.getQueryData(key)! as Post | Pagination<Post>).isRead).toBe(false);
    expect(firstPost(result).isRead).toBe(true);
    expect(firstPost(initial).isRead).toBe(false);
    if (peek) expect(peek()?.nodes[0]?.isRead).toBe(true);

    const calls = transport.mock.calls.length;
    expect(firstPost(await load()).isRead).toBe(true);
    expect(transport).toHaveBeenCalledTimes(calls);
  });

  it("merges confirmed marks immutably and preserves references when nothing changes", async () => {
    const nodes = [{ id: "read-post", isRead: false }, { id: "unrelated", isRead: false }];
    const initialRevision = api.readStatusRevision.value;
    expect(isReadonly(api.readStatusRevision)).toBe(true);
    expect(api.mergeReadStatus(nodes)).toBe(nodes);
    transport.mockResolvedValue(undefined);
    await api.markAsReadBatch(["read-post"]);

    const merged = api.mergeReadStatus(nodes);
    expect(merged).not.toBe(nodes);
    expect(merged[0]).toEqual({ id: "read-post", isRead: true });
    expect(merged[0]).not.toBe(nodes[0]);
    expect(merged[1]).toBe(nodes[1]);
    expect(nodes[0]!.isRead).toBe(false);
    expect(api.mergeReadStatus(merged)).toBe(merged);
    expect(api.readStatusRevision.value).toBe(initialRevision + 1);

    await api.markAsReadBatch(["read-post"]);
    expect(api.readStatusRevision.value).toBe(initialRevision + 1);
  });

  it("does not confirm pending or failed writes and clears confirmed state on identity changes", async () => {
    const nodes = [{ id: "read-post", isRead: false }];
    const revision = api.readStatusRevision.value;
    const failure = deferred<void>();
    transport.mockReturnValue(failure.promise);
    const marking = api.markAsReadBatch(["read-post"]);
    expect(api.mergeReadStatus(nodes)).toBe(nodes);
    failure.reject(new Error("write failed"));
    await expect(marking).rejects.toThrow("write failed");
    expect(api.mergeReadStatus(nodes)).toBe(nodes);
    expect(api.readStatusRevision.value).toBe(revision);

    transport.mockResolvedValue(undefined);
    await api.markAsReadBatch(["read-post"]);
    expect(api.mergeReadStatus(nodes)[0]!.isRead).toBe(true);
    api.clearAllCache();
    expect(api.mergeReadStatus(nodes)).toBe(nodes);
    expect(api.readStatusRevision.value).toBe(revision + 2);
    api.clearAllCache();
    expect(api.readStatusRevision.value).toBe(revision + 2);
  });

  it("ignores a previous identity's read success after its cache was cleared", async () => {
    const nodes = [{ id: "read-post", isRead: false }];
    const response = deferred<void>();
    transport.mockReturnValue(response.promise);
    const marking = api.markAsReadBatch(["read-post"]);
    // Resolve the transport, then switch identities before useApi's await
    // continuation runs. This is later than a transport-level auth guard.
    response.resolve();
    api.clearAllCache();
    const revision = api.readStatusRevision.value;
    await marking;
    expect(api.mergeReadStatus(nodes)).toBe(nodes);
    expect(api.readStatusRevision.value).toBe(revision);
  });
});
