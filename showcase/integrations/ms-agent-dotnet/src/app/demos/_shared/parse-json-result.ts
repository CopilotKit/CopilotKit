// Coerces a tool-call result into a typed object. The .NET AG-UI adapter can
// wrap JSON string tool results in another JSON string, so parse a few layers.
export function parseJsonResult<T>(result: unknown): T {
  let parsed = result;

  for (let depth = 0; depth < 3 && typeof parsed === "string"; depth += 1) {
    if (!parsed.trim()) return {} as T;

    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {} as T;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {} as T;
  }

  return parsed as T;
}
