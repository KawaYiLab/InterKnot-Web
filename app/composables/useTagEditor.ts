import { onScopeDispose, ref } from "vue";
import type { Tag } from "~/types/entities";
import { MAX_TAGS_PER_ARTICLE, normalizeTagName, normalizeTagNames, toTagSlug } from "~/utils/tags";

export function useTagEditor(options: {
  suggest: (query: string, signal: AbortSignal) => Promise<Tag[]>;
  onChange: () => void;
  warn: (text: string) => void;
  disabled?: () => boolean;
}) {
  const selectedTags = ref<string[]>([]);
  const tagInput = ref("");
  const tagSuggestions = ref<Tag[]>([]);
  const isComposing = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let revision = 0;
  let disposed = false;

  function clearSuggestions() {
    revision++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    request?.abort();
    request = undefined;
    tagSuggestions.value = [];
  }

  function resetTags(names: readonly unknown[] = []) {
    clearSuggestions();
    isComposing.value = false;
    tagInput.value = "";
    selectedTags.value = normalizeTagNames(names);
  }

  function addTag(raw: string) {
    if (disposed || isComposing.value || options.disabled?.()) return;
    const name = normalizeTagName(raw);
    if (!name) {
      if (raw.trim()) options.warn("标签至少需要包含一个字母、汉字或数字");
      return;
    }
    const slug = toTagSlug(name);
    const duplicate = selectedTags.value.some((tag) => toTagSlug(tag) === slug);
    if (!duplicate && selectedTags.value.length >= MAX_TAGS_PER_ARTICLE) {
      options.warn(`最多只能添加 ${MAX_TAGS_PER_ARTICLE} 个标签`);
      return;
    }
    tagInput.value = "";
    clearSuggestions();
    if (duplicate) return;
    selectedTags.value.push(name);
    options.onChange();
  }

  function removeTag(index: number) {
    if (disposed || options.disabled?.() || index < 0 || index >= selectedTags.value.length) return;
    selectedTags.value.splice(index, 1);
    options.onChange();
  }

  function onTagInput(event?: Event) {
    // v-model intentionally ignores input events during composition. Read the
    // committed DOM value, and invalidate an older request before the debounce.
    if (event?.target instanceof HTMLInputElement) tagInput.value = event.target.value;
    clearSuggestions();
    if (disposed || isComposing.value || (event as InputEvent | undefined)?.isComposing) return;
    const query = normalizeTagName(tagInput.value);
    if (!query || selectedTags.value.length >= MAX_TAGS_PER_ARTICLE) return;
    const currentRevision = revision;
    timer = setTimeout(async () => {
      timer = undefined;
      const controller = new AbortController();
      request = controller;
      try {
        const list = await options.suggest(query, controller.signal);
        if (disposed || currentRevision !== revision) return;
        const selected = new Set(selectedTags.value.map(toTagSlug));
        tagSuggestions.value = list.filter((tag) => !selected.has(toTagSlug(tag.name)));
      } catch {
        if (!disposed && currentRevision === revision) tagSuggestions.value = [];
      } finally {
        if (request === controller) request = undefined;
      }
    }, 200);
  }

  function onTagCompositionStart() {
    isComposing.value = true;
    clearSuggestions();
  }

  function onTagCompositionEnd(event: CompositionEvent) {
    isComposing.value = false;
    onTagInput(event);
  }

  function onTagEnter(event: KeyboardEvent) {
    // Preventing the default before this check also prevents IME confirmation.
    if (event.isComposing || isComposing.value || event.keyCode === 229) return;
    event.preventDefault();
    addTag(tagInput.value);
  }

  onScopeDispose(() => {
    disposed = true;
    clearSuggestions();
  });

  return {
    selectedTags, tagInput, tagSuggestions, isComposing,
    addTag, removeTag, resetTags, onTagInput, onTagEnter,
    onTagCompositionStart, onTagCompositionEnd,
  };
}
