export type Overlay = "links" | "depth" | "health" | "parity" | "docs";
export type OverlaySet = Set<Overlay>;

export const ALL_OVERLAYS: readonly Overlay[] = [
  "links",
  "depth",
  "health",
  "parity",
  "docs",
] as const;

export const DEFAULT_OVERLAYS: readonly Overlay[] = [
  "links",
  "health",
] as const;

export interface OverlayPreset {
  id: string;
  label: string;
  overlays: readonly Overlay[];
}

export const PRESETS: readonly OverlayPreset[] = [
  { id: "catalog", label: "Catalog", overlays: ["links", "health", "docs"] },
  { id: "assessment", label: "Assessment", overlays: ["depth", "health"] },
  {
    id: "parity-review",
    label: "Parity Review",
    overlays: ["depth", "parity"],
  },
] as const;

/** Legacy hash → overlay set mapping for backwards compatibility */
export const LEGACY_REDIRECTS: Record<string, readonly Overlay[]> = {
  coverage: ["links", "health"],
  cells: ["depth"],
  parity: ["depth", "parity"],
  packages: ["health"],
  status: [], // special case: redirects to #ops
} as const;

/** Overlays that trigger the contextual filter bar */
export const FILTER_TRIGGER_OVERLAYS: readonly Overlay[] = [
  "depth",
  "parity",
] as const;
