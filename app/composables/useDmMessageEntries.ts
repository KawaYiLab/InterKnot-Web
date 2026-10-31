import { computed, type ComputedRef, type Ref } from "vue";
import type { DmMessage } from "~/types/entities";
import type { EnrichedMessage } from "~/utils/dm-view";

export function useDmMessageEntries(
  messages: Ref<DmMessage[]>,
  derive: (message: DmMessage, previousCreatedAt: string | undefined) => EnrichedMessage,
): ComputedRef<EnrichedMessage[]> {
  type CachedEntry = {
    message: DmMessage;
    previousCreatedAt: string | undefined;
    value: ComputedRef<EnrichedMessage>;
  };
  let cache = new Map<string, CachedEntry>();

  return computed(() => {
    const list = messages.value;
    const nextCache = new Map<string, CachedEntry>();
    const entries = list.map((message, index) => {
      const previousCreatedAt = list[index - 1]?.createdAt;
      let entry = cache.get(message.documentId);
      if (!entry || entry.message !== message || entry.previousCreatedAt !== previousCreatedAt) {
        entry = {
          message,
          previousCreatedAt,
          // 每条消息独立收集响应式依赖，吐字不使历史消息的派生数据失效。
          value: computed(() => derive(message, previousCreatedAt)),
        };
      }
      nextCache.set(message.documentId, entry);
      return entry.value.value;
    });
    cache = nextCache;
    return entries;
  });
}
