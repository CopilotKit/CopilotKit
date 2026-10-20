import { marked } from "marked";
import { completePartialMarkdown } from "./complete-partial-markdown";
import type { MarkdownTokenList } from "./types";

export interface ParseMarkdownOptions {
  /**
   * When true (default), the input is run through `completePartialMarkdown`
   * first so that incomplete streaming markdown (unterminated emphasis, code
   * fences, links) renders cleanly. Set false to parse the raw string as-is.
   */
  complete?: boolean;
}

/**
 * Parse a markdown string into a framework-agnostic token tree.
 *
 * Uses `marked`'s lexer (GFM enabled) so the result is DOM-free and can be
 * walked into React, Vue, or React Native elements by each framework's
 * built-in renderer.
 */
export function parseMarkdown(
  content: string,
  options: ParseMarkdownOptions = {},
): MarkdownTokenList {
  const src = !content
    ? ""
    : options.complete === false
      ? content
      : completePartialMarkdown(content);
  return marked.lexer(src, { gfm: true, breaks: true });
}
