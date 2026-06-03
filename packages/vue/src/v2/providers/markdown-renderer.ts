import { inject } from "vue";
import type { Component, InjectionKey } from "vue";
import type { VueStreamingMarkdownNodeRenderers } from "@copilotkit/markdown-renderer/vue";
import type { StreamingMarkdownParserOptions } from "@copilotkit/markdown-renderer";

/** Config for the built-in Vue default renderer (pass instead of a component). */
export interface DefaultMarkdownRendererProps {
  nodeRenderers?: VueStreamingMarkdownNodeRenderers;
  caret?: boolean;
  options?: Partial<StreamingMarkdownParserOptions>;
  class?: string;
}

export type MarkdownRendererValue = Component | DefaultMarkdownRendererProps;

/** Injection key for a global markdown renderer component (or `undefined`). */
export const MARKDOWN_RENDERER_KEY: InjectionKey<MarkdownRendererValue | undefined> =
  Symbol("copilotkit-markdown-renderer");

/**
 * The markdown renderer provided at the provider level, or `undefined`.
 * Message components fall back to the built-in `StreamingMarkdownDefault` when undefined.
 * The renderer is a Vue component accepting `{ content: string; isStreaming?: boolean }`.
 */
export function useMarkdownRenderer(): MarkdownRendererValue | undefined {
  return inject(MARKDOWN_RENDERER_KEY, undefined);
}

/** A Vue component is a function or an object carrying setup/render/__vccOpts/__name. */
export function isVueComponentRenderer(value: unknown): value is Component {
  if (typeof value === "function") return true;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return "setup" in o || "render" in o || "__vccOpts" in o || "__name" in o;
  }
  return false;
}
