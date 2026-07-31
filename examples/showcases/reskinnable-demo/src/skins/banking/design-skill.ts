/**
 * OGUI design brief handed to generateSandboxedUi so generated UIs match the
 * Northwind Finance aesthetic instead of the generic default. Carried over
 * VERBATIM from the string wrapper.tsx passes as openGenerativeUI.designSkill.
 */
export const NORTHWIND_DESIGN_SKILL = `You are designing UI for Northwind Finance, a
corporate banking dashboard. Match its aesthetic:
- Surfaces: rounded-2xl cards, subtle hairline borders, soft shadow, a translucent
  "glass" surface over the page background. Generous padding.
- Type: the Geist sans-serif family; clear hierarchy (semibold headings, muted
  secondary text). Currency in USD with thousands separators.
- Color: a restrained neutral base with a single indigo/violet brand accent for
  emphasis, positive = green, negative/over-limit = red. Never rainbow palettes.
- Dark-mode aware: read colors from CSS variables / prefers-color-scheme; never
  hardcode white backgrounds.
- Keep it calm, precise, and enterprise-appropriate — this is a finance tool.`;
