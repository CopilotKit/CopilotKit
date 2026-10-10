export interface Source { url: string; title: string }
export interface SourceResult { sources: Source[]; failed: boolean; recognized: boolean }

/** Extract safe source links and failure status from structured or serialized MCP results. */
export function readSources(result: unknown): SourceResult {
  const sources = new Map<string, Source>();
  let failed = false;
  let recognized = false;
  /** Traverse result containers up to six levels; JSON decoding adds no structural depth. */
  function visit(value: unknown, depth = 0) {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
      try { visit(JSON.parse(value), depth); } catch { /* Non-JSON text has no source records. */ }
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results) || record.isError === true) recognized = true;
    if (record.isError === true || record.error || (Array.isArray(record.errors) && record.errors.length)) failed = true;
    if (typeof record.url === "string") {
      try {
        const url = new URL(record.url);
        if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
          sources.set(url.href, { url: url.href, title: typeof record.title === "string" && record.title ? record.title : url.hostname });
        }
      } catch { /* Ignore malformed provider URLs. */ }
    }
    for (const key of ["structuredContent", "content", "text", "results"]) visit(record[key], depth + 1);
  }
  visit(result);
  return { sources: [...sources.values()].slice(0, 20), failed, recognized };
}
