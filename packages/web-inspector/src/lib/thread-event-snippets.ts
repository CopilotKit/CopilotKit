export const THREAD_EVENT_SNIPPETS_STORAGE_KEY =
  "cpk:inspector:thread-event-snippets";

export type ThreadSnippetEvent = {
  type: string;
  [key: string]: unknown;
};

export type ThreadEventSnippet = {
  id: string;
  name: string;
  sourceThreadId: string;
  sourceThreadName: string;
  events: ThreadSnippetEvent[];
  createdAt: string;
  updatedAt: string;
};

export function createThreadEventSnippetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cpk-thread-snippet-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function parseThreadSnippetEvents(raw: string): ThreadSnippetEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Events JSON is invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Events JSON must be an array.");
  }
  if (parsed.length === 0) {
    throw new Error("Choose a thread with at least one event.");
  }
  return parsed.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("Each event must be an object with a string type.");
    }
    const candidate = event as { type?: unknown };
    if (typeof candidate.type !== "string" || candidate.type.length === 0) {
      throw new Error("Each event must have a string type.");
    }
    return event as ThreadSnippetEvent;
  });
}

export function loadThreadEventSnippets(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): ThreadEventSnippet[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(THREAD_EVENT_SNIPPETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const snippet = parseStoredSnippet(item);
      return snippet ? [snippet] : [];
    });
  } catch {
    return [];
  }
}

export function upsertThreadEventSnippet(
  snippet: ThreadEventSnippet,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): ThreadEventSnippet[] {
  if (!storage) throw new Error("Snippet storage is not available.");
  const current = loadThreadEventSnippets(storage);
  const index = current.findIndex((item) => item.id === snippet.id);
  const next =
    index === -1
      ? [snippet, ...current]
      : current.map((item, itemIndex) =>
          itemIndex === index ? snippet : item,
        );
  storage.setItem(THREAD_EVENT_SNIPPETS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteThreadEventSnippet(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): ThreadEventSnippet[] {
  if (!storage) throw new Error("Snippet storage is not available.");
  const next = loadThreadEventSnippets(storage).filter(
    (snippet) => snippet.id !== id,
  );
  storage.setItem(THREAD_EVENT_SNIPPETS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function exportThreadEventSnippets(
  snippets: readonly ThreadEventSnippet[],
): string {
  return JSON.stringify(snippets, null, 2);
}

function parseStoredSnippet(value: unknown): ThreadEventSnippet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ThreadEventSnippet>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.sourceThreadId !== "string" ||
    typeof candidate.sourceThreadName !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !Array.isArray(candidate.events)
  ) {
    return null;
  }
  try {
    return {
      ...candidate,
      events: parseThreadSnippetEvents(JSON.stringify(candidate.events)),
    } as ThreadEventSnippet;
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
