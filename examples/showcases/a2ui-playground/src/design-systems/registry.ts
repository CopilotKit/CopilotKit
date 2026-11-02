/**
 * The design systems the playground can draw a surface with. The agent writes the same A2UI either way:
 * the catalog (component names and props) is the contract, and a design system is one implementation of it.
 * Switching repaints every surface on the page without asking the model again.
 */
export type DesignSystemId = "copilotkit" | "chatcn" | "byoc";

export const DESIGN_SYSTEMS: Array<{
  id: DesignSystemId;
  label: string;
  /** What draws the surface, shown next to the label in the picker. */
  note: string;
  /** One sentence for the picker and the Get started page. */
  hint: string;
}> = [
  {
    id: "copilotkit",
    label: "CopilotKit",
    note: "Standard catalog",
    hint: "The Gen UI 2.0 standard components, as CopilotKit ships them.",
  },
  {
    id: "chatcn",
    label: "ChatCN",
    note: "shadcn/ui",
    hint: "The same catalog drawn with shadcn/ui primitives, the components ChatCN builds on.",
  },
  {
    id: "byoc",
    label: "Bring your own",
    note: "Your components",
    hint: "A hand-written in-house component set mapped onto the same catalog: your look, the same A2UI.",
  },
];

export const DEFAULT_DESIGN_SYSTEM: DesignSystemId = "copilotkit";

export const isDesignSystem = (v: unknown): v is DesignSystemId =>
  DESIGN_SYSTEMS.some((d) => d.id === v);

export const designSystemLabel = (id: DesignSystemId) =>
  DESIGN_SYSTEMS.find((d) => d.id === id)?.label ?? id;
