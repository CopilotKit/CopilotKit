/**
 * Shared status/priority → emoji mapping for the Linear components.
 * Unicode glyphs work everywhere in Discord (there's no mrkdwn shortcode
 * system like Slack's); both `*Shortcode` and `*Unicode` variants use real
 * Unicode so they render correctly in any Discord text context.
 */

/** Linear workflow-state name → status dot (unicode emoji). */
export function stateShortcode(state?: string): string {
  const s = (state ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return "✅";
  if (s.includes("progress") || s.includes("started")) return "🔵";
  if (s.includes("review")) return "🟣";
  if (s.includes("cancel")) return "🚫";
  if (s.includes("backlog")) return "⚪";
  return "🟠"; // Todo / triage / unknown
}

/** Same mapping, as a unicode glyph (identical to stateShortcode on Discord). */
export function stateUnicode(state?: string): string {
  return stateShortcode(state);
}

/** Linear priority label → emoji, or "" for none. */
export function priorityShortcode(priority?: string): string {
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
