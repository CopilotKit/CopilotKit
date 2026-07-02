// meta.ts
export type TriageMeta = {
  reproducible: boolean | null;
  area: string | null;
  severity: string | null;
  labels: string[];
};
const FENCE = /```triage-meta\s*\n([\s\S]*?)\n```/;
export function extractMeta(agentText: string): {
  body: string;
  meta: TriageMeta | null;
} {
  const m = FENCE.exec(agentText);
  const body = agentText.replace(FENCE, "").trim();
  if (!m) return { body: agentText, meta: null };
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>;
    const labels = Array.isArray(raw.labels)
      ? raw.labels.filter((x): x is string => typeof x === "string")
      : [];
    return {
      body,
      meta: {
        reproducible:
          typeof raw.reproducible === "boolean" ? raw.reproducible : null,
        area: typeof raw.area === "string" ? raw.area : null,
        severity: typeof raw.severity === "string" ? raw.severity : null,
        labels,
      },
    };
  } catch {
    return { body, meta: null };
  }
}
