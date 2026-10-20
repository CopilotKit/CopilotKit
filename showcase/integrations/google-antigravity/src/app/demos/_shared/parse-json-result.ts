// Coerces a tool-call result into a typed object. Tool results arrive
// as strings when the agent emits JSON or as already-parsed objects
// when the runtime decoded them upstream — this helper handles both
// shapes and returns `{}` if the result is missing or unparseable.
export function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}
