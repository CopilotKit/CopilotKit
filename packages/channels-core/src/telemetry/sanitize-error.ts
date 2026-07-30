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

// `Adapter.platform` is a free-form string an adapter author sets, so a custom
// third-party adapter could put a tenant/project name there. Bound it to the
// known platforms and bucket everything else as "custom" — prevents leaking
// caller-chosen labels and caps telemetry cardinality.
const KNOWN_PLATFORMS = new Set([
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "teams",
]);
export function normalizePlatform(platform: string): string {
  return KNOWN_PLATFORMS.has(platform) ? platform : "custom";
}
