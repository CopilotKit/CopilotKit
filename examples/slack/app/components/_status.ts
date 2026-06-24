/**
 * Shared status/priority → glyph mapping for the Linear components. The
 * functions return unicode glyphs (not Slack `:shortcode:` strings), so the
 * components render identically on Slack and Telegram.
 */

/** Unicode glyph for a Linear workflow-state name. */
export function stateGlyph(state?: string): string {
  const s = (state ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return "✅";
  if (s.includes("progress") || s.includes("started")) return "🔵";
  if (s.includes("review")) return "🟣";
  if (s.includes("cancel")) return "🚫";
  if (s.includes("backlog")) return "⚪";
  return "🟠";
}

/** Unicode glyph for a Linear priority label, or "" for none/unknown. */
export function priorityGlyph(priority?: string): string {
  const p = (priority ?? "").toLowerCase();
  if (p.includes("urgent")) return "🚨";
  if (p.includes("high")) return "🔴";
  if (p.includes("medium")) return "🟠";
  if (p.includes("low")) return "⚪";
  return "";
}

/** Brand + semantic accent colors for the attachment left-border. */
export const ACCENT = {
  linear: "#5E6AD2",
  notion: "#2F3437",
  urgent: "#EB5757",
  high: "#F2994A",
  done: "#27AE60",
  progress: "#2D9CDB",
  canceled: "#9B9B9B",
} as const;

/**
 * Accent color for a single issue: priority wins (urgent/high), then state
 * (done/in-progress/canceled), falling back to Linear purple.
 */
export function accentForIssue(issue: {
  state?: string;
  priority?: string;
}): string {
  const p = (issue.priority ?? "").toLowerCase();
  if (p.includes("urgent")) return ACCENT.urgent;
  if (p.includes("high")) return ACCENT.high;
  const s = (issue.state ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return ACCENT.done;
  if (s.includes("cancel")) return ACCENT.canceled;
  if (s.includes("progress") || s.includes("started")) return ACCENT.progress;
  return ACCENT.linear;
}

/** Accent for a list: surface the hottest priority present, else Linear purple. */
export function accentForIssues(
  issues: ReadonlyArray<{ priority?: string }>,
): string {
  const prios = issues.map((i) => (i.priority ?? "").toLowerCase());
  if (prios.some((p) => p.includes("urgent"))) return ACCENT.urgent;
  if (prios.some((p) => p.includes("high"))) return ACCENT.high;
  return ACCENT.linear;
}
