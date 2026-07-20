export const LABEL_COLORS: Record<string, string> = {
  bug: "d73a4a",
  "needs-repro": "fbca04",
  question: "d876e3",
  documentation: "0075ca",
  enhancement: "a2eeef",
  "not-reproducible": "c5def5",
};
export function resolveLabels(requested: string[]): string[] {
  const out = new Set<string>();
  for (const r of requested) {
    const l = r.trim().toLowerCase();
    if (!l) continue;
    if (l in LABEL_COLORS || l.startsWith("area:") || l.startsWith("severity:"))
      out.add(l);
  }
  return [...out];
}
