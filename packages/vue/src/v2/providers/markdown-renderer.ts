import { inject } from "vue";
import type { Component, InjectionKey } from "vue";

/** Injection key for a global markdown renderer component. */
export const MARKDOWN_RENDERER_KEY: InjectionKey<Component> = Symbol(
  "copilotkit-markdown-renderer",
);

/**
 * The markdown renderer provided at the provider level, or `undefined`.
 * Message components fall back to the built-in `BasicMarkdown` when undefined.
 * The renderer is a Vue component accepting `{ content: string; isStreaming?: boolean }`.
 */
export function useMarkdownRenderer(): Component | undefined {
  return inject(MARKDOWN_RENDERER_KEY, undefined);
}
