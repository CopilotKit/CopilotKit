/**
 * The OGUI design brief for Myelin — injected as agent context to style any
 * sandboxed UI the agent generates. Written against the shared tokens so a
 * generated panel rebrands with the tenant like everything else.
 */
export const MYELIN_DESIGN_SKILL = `
Myelin is an admin console for a frontline learning platform (tenant: Harvest Lane Grocers).
Style generated UI as calm, dense product UI, not marketing:
- Use the CSS variables: hsl(var(--surface)) cards on hsl(var(--canvas)), hsl(var(--ink)) text,
  hsl(var(--ink-muted)) secondary text, hsl(var(--hairline)) 1px borders, hsl(var(--brand)) for the one primary
  action and for progress, hsl(var(--brand-violet)) only as a small accent.
- Rounded corners var(--radius). 13–14px body text. Tabular numbers for minutes, counts and percentages.
- Learning journeys read left to right: steps as small cards, prerequisites as connecting lines.
- Never show learner names; show counts.
`.trim();
