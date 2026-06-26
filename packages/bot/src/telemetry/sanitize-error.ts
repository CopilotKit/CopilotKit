// Map an arbitrary thrown value to a bounded, non-identifying category.
// NEVER returns the error message or stack — only a fixed-cardinality label.
export function errorClass(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "";
  const code = typeof e?.code === "string" ? e.code : "";
  const hay = `${name} ${code}`.toLowerCase();
  if (/abort|timeout|etimedout|deadline/.test(hay)) return "timeout";
  if (/network|fetch|econn|enotfound|socket|dns|epipe/.test(hay))
    return "network";
  if (/auth|unauthorized|forbidden|token|credential|401|403/.test(hay))
    return "auth";
  if (/zod|valid|schema|parse/.test(hay)) return "validation";
  return "unknown";
}
