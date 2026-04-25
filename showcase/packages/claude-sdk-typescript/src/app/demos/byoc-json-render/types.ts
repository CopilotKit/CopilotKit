/**
 * Shared types for the byoc-json-render demo catalog.
 *
 * Ported from langgraph-python's byoc-json-render demo — shape is identical
 * because both demos consume the same `@json-render/react` renderer and
 * catalog.
 */

export type MetricCardTrendDirection = "up" | "down" | "neutral";

export interface JsonRenderElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
}
