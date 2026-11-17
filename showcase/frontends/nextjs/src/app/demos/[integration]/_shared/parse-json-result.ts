// Coerces a tool-call result into a typed object. A result can arrive as an
// object the runtime already decoded, or as a JSON string. Some agent
// adapters (the .NET AG-UI adapter, for example) wrap that JSON string in
// another JSON string, so this parses up to three layers. It returns `{}` when
// the result is missing, unparseable, or not an object.
export function parseJsonResult<T>(result: unknown) {
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
