/**
 * The design systems the playground can draw a surface with. The agent writes the same A2UI either way:
 * the catalog (component names and props) is the contract, and a design system is one implementation of it.
 * Switching repaints every surface on the page without asking the model again.
 */
export type DesignSystemId = "copilotkit" | "shadcn" | "material" | "byoc";

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
    id: "shadcn",
    label: "shadcn/ui",
    note: "Radix and Tailwind",
    hint: "The same catalog drawn with shadcn/ui components in its neutral palette.",
  },
  {
    id: "material",
    label: "Material",
    note: "Material 3 Expressive",
    hint: "The same catalog drawn with Material 3 Expressive components in a Material color scheme.",
  },
  {
    id: "byoc",
    label: "Bring your own",
    note: "Your components",
    hint: "A hand-written in-house component set mapped onto the same catalog: your look, the same A2UI.",
  },
];

export const DEFAULT_DESIGN_SYSTEM: DesignSystemId = "copilotkit";

/** A class the surface host carries under a design system: Material's tokens resolve inside its theme scope. */
export const HOST_CLASS: Partial<Record<DesignSystemId, string>> = {
  material: "m3e-theme",
};

export const isDesignSystem = (v: unknown): v is DesignSystemId =>
  DESIGN_SYSTEMS.some((d) => d.id === v);

/** Ids that were renamed, so a link or a saved pick made under the old one still finds its design system. */
const RENAMED: Record<string, DesignSystemId> = { chatcn: "shadcn" };

/** The design system a `?ds=` value or a saved pick names, or null when it names none. */
export const toDesignSystem = (v: string | null): DesignSystemId | null => {
  const id = v === null ? null : (RENAMED[v] ?? v);
  return isDesignSystem(id) ? id : null;
};

export const designSystemLabel = (id: DesignSystemId) =>
  DESIGN_SYSTEMS.find((d) => d.id === id)?.label ?? id;
