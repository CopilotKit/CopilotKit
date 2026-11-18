/**
 * The audience rules an admin can apply to clear an overlap, as the admin sees
 * them (label) and as the platform stores them (rule).
 *
 * WITHHELD FROM THE AGENT. This module is imported by the Journeys page (the
 * admin's dropdown) and by the store (to resolve what was sent) — never by
 * tools.tsx, a readable, a tool schema or a refusal. The teach-a-skill beat
 * depends on the agent learning which rule works by watching an admin once.
 */
export const RULE_OPTIONS = [
  {
    rule: "stagger",
    label: "Stagger: start after their current journey finishes",
  },
  { rule: "exclude", label: "Exclude overlapping learners from this journey" },
  {
    rule: "override-cap",
    label: "Override the one-onboarding-at-a-time policy",
  },
] as const;

export type AudienceRuleName = (typeof RULE_OPTIONS)[number]["rule"];

function normalize(text: string): string {
  return text
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Resolve what a caller sent to a rule, accepting EITHER the rule name or the
 * label the admin saw. A learned procedure written from a demonstration names
 * both ("apply the rule named "stagger" using the label "Stagger: start after
 * …"), and the agent may replay either one — refusing the label as unknown made
 * the replay fail on stage even though it had learned exactly the right choice.
 */
export function resolveAudienceRule(sent: string): AudienceRuleName | null {
  const needle = normalize(sent);
  const hit = RULE_OPTIONS.find(
    (o) => normalize(o.rule) === needle || normalize(o.label) === needle,
  );
  return hit?.rule ?? null;
}
