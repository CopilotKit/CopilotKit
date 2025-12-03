/**
 * Safely read a Response/Request body with sensible defaults:
 * - clones the response/request to avoid consuming the original response/request
 * - Skips GET/HEAD
 * - Tries JSON first regardless of content-type
 * - Falls back to text and optionally parses when it "looks" like JSON
 */
export async function readBody<T extends Response | Request>(r: T): Promise<unknown> {
  // skip GET/HEAD requests (unchanged)
  const method = "method" in r ? r.method.toUpperCase() : undefined;
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  // no body at all → undefined (unchanged)
  if (!("body" in r) || r.body == null) {
    return undefined;
  }

  // 1) try JSON (unchanged)
  try {
    return await r.clone().json();
  } catch {
    // 2) try text (unchanged + your whitespace/JSON-heuristic)
    try {
      const text = await r.clone().text();
      const trimmed = text.trim();

      if (trimmed.length === 0) return text;

      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return text;
        }
      }
      return text;
    } catch {
      // 3) FINAL FALLBACK: manual read that accepts string or bytes
      try {
        const c = r.clone();
        const stream: ReadableStream | null = c.body ?? null;
        if (!stream) return undefined;

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let out = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (typeof value === "string") {
            out += value; // accept string chunks
          } else {
            out += decoder.decode(value, { stream: true }); // bytes
          }
        }
        out += decoder.decode(); // flush

        const trimmed = out.trim();
        if (trimmed.length === 0) return out;

        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            return JSON.parse(trimmed);
          } catch {
            return out;
          }
        }
        return out;
      } catch {
        return undefined; // same "give up" behavior you had
      }
    }
  }
}
