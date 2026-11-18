import { render as renderKatex } from "katex";
import {
  CHAT_MARKDOWN_NODE_CLASS_NAMES,
  warnUnsupportedRichSyntaxOnce,
} from "@copilotkit/markdown";
import { createStreamingMarkdownDomRenderer } from "@copilotkit/markdown/dom";
import type {
  StreamingMarkdownDomNodeRenderers,
  StreamingMarkdownDomRenderer,
} from "@copilotkit/markdown/dom";

/**
 * Typesets `math` nodes with KaTeX. `katex.render()` builds DOM nodes itself,
 * so no HTML string is parsed and no sanitizer is needed; `trust: false`
 * keeps KaTeX's own link and HTML commands off.
 *
 * KaTeX creates nodes with the global `document`, which server DOMs do not
 * have; there the TeX source is shown until the browser renders it.
 */
const nodeRenderers: StreamingMarkdownDomNodeRenderers = {
  math: ({ node, document }) => {
    const span = document.createElement("span");
    if (node.type !== "math") return span;
    if (typeof globalThis.document === "undefined") {
      span.textContent = node.text;
      return span;
    }
    renderKatex(node.text, span, {
      displayMode: node.display,
      throwOnError: false,
      trust: false,
    });
    return span;
  },
};

/** What the assistant message renderer passes on each change. */
export interface AssistantMarkdownInput {
  content: string;
  isStreaming: boolean;
}

/**
 * Renders assistant markdown into `container` with `@copilotkit/markdown`'s
 * shared engine (the same parser, markup, sanitization, caret and per-token
 * fade-in as React and Vue), plus KaTeX math.
 *
 * Empty content renders nothing, like React's default renderer.
 *
 * @param container - Element to render into; the renderer owns its children.
 * @returns `render(input)` for each change and `destroy()` for teardown.
 */
export function createAssistantMarkdownRenderer(container: HTMLElement) {
  let renderer: StreamingMarkdownDomRenderer | null = null;

  function destroy() {
    renderer?.destroy();
    renderer = null;
  }

  function render({ content, isStreaming }: AssistantMarkdownInput) {
    if (!content) {
      destroy();
      return;
    }
    warnUnsupportedRichSyntaxOnce(content, { rendersMath: true });
    renderer ??= createStreamingMarkdownDomRenderer(container);
    renderer.render({
      content,
      isComplete: !isStreaming,
      caret: isStreaming,
      options: { enableMath: true },
      nodeRenderers,
      nodeClassNames: CHAT_MARKDOWN_NODE_CLASS_NAMES,
    });
  }

  return { render, destroy };
}
