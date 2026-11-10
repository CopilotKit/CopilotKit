"use client";

/**
 * Which component draws each catalog name under each design system. The catalog (`src/a2ui/catalog`)
 * wraps every component once and asks here at render time, so switching design systems repaints a
 * surface in place: same component ids, same data model, same A2UI.
 */
import type { ComponentType } from "react";
import { byocOwn, byocStandard } from "./byoc";
import { chatcnOwn, chatcnStandard } from "./chatcn";
import { useDesignSystem } from "./context";
import { materialOwn, materialStandard } from "./material";
import type { DesignSystemId } from "./registry";

type AnyComponent = ComponentType<never>;
type Overrides = {
  /** Standard components: they get the engine's props directly. */
  standard: Record<string, AnyComponent>;
  /** The playground's own components: they get `{ props }`, like their renderers. */
  own: Record<string, AnyComponent>;
};

const OVERRIDES: Record<DesignSystemId, Overrides> = {
  copilotkit: { standard: {}, own: {} },
  chatcn: {
    standard: chatcnStandard as Record<string, AnyComponent>,
    own: chatcnOwn as Record<string, AnyComponent>,
  },
  material: {
    standard: materialStandard as Record<string, AnyComponent>,
    own: materialOwn as Record<string, AnyComponent>,
  },
  byoc: {
    standard: byocStandard as Record<string, AnyComponent>,
    own: byocOwn as Record<string, AnyComponent>,
  },
};

/** The design system's component for `name`, or undefined to keep the default. */
export function useOverride(kind: keyof Overrides, name: string) {
  const { id } = useDesignSystem();
  return OVERRIDES[id][kind][name];
}

/** How many catalog components a design system draws with its own code (the rest are themed defaults). */
export const overrideCount = (id: DesignSystemId) =>
  Object.keys(OVERRIDES[id].standard).length +
  Object.keys(OVERRIDES[id].own).length;
