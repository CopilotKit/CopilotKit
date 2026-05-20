/**
 * Shared types for the byoc-json-render demo catalog.
 */

export type MetricCardTrendDirection = "up" | "down" | "neutral";

/**
 * Shape of the streaming JSON spec emitted by the agent. Matches
 * `@json-render/react`'s Spec contract: a flat `elements` map keyed by
 * id, with one designated `root` id.
 */
export interface JsonRenderElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
}
