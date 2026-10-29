import { Marked, TokenizerAndRendererExtension } from "marked";
import type { HLJSApi } from "highlight.js";
import type { KatexOptions } from "katex";
import DOMPurify from "dompurify";
import { completePartialMarkdown } from "@copilotkit/core";

/**
 * DOMPurify instance owned by this module, or undefined without a DOM. The
 * default export is a global instance shared with the host app, whose
 * setConfig() overrides our per-call config and whose hooks would run inside
 * our sanitization, so it is not used here.
 */
const purifier = typeof window === "undefined" ? undefined : DOMPurify(window);
purifier?.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// highlight.js and KaTeX are the two heavy libraries of the chat. Neither
// is needed until a reply has a code block or a formula, so each loads on
// its first use, in its own chunk. Until it arrives, a code block shows its
// plain text and a formula its TeX source; the renderers listen for the
// arrival and render again.

type MathRenderer = (tex: string, options: KatexOptions) => string;

let highlighter: HLJSApi | undefined;
let highlighterLoading: Promise<void> | undefined;
let mathRenderer: MathRenderer | undefined;
let mathLoading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

function loadHighlighter() {
  if (highlighter || typeof window === "undefined") return highlighterLoading;
  highlighterLoading ??= import("highlight.js/lib/common").then((module) => {
    highlighter = module.default;
    notify();
  });
  return highlighterLoading;
}

function loadMath() {
  if (mathRenderer || typeof window === "undefined") return mathLoading;
  mathLoading ??= import("katex").then((module) => {
    const katex =
      (module as { default?: { renderToString: MathRenderer } }).default ??
      (module as unknown as { renderToString: MathRenderer });
    mathRenderer = katex.renderToString.bind(katex);
    notify();
  });
  return mathLoading;
}

/**
 * Calls `listener` when highlight.js or KaTeX has loaded, so a rendered
 * message can render again with highlighted code or typeset math. Returns
 * the function that removes the listener.
 */
export function onMarkdownLibrariesLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Loads highlight.js and KaTeX now instead of on first use. The chat does
 * not need it; a test, or an app that wants no late re-render, may call it.
 */
export async function preloadMarkdownLibraries(): Promise<void> {
  await Promise.all([loadHighlighter(), loadMath()]);
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Sanitizes rendered markdown into a DOM fragment with DOMPurify's default
 * allowlist. Returning nodes instead of a string means the sanitized tree is
 * never serialized and parsed again, which is where mutation XSS happens.
 *
 * Returns null when sanitization cannot run (no DOM, for example during server
 * rendering, or an unsupported environment, where sanitize() would return its
 * input unchanged). Callers must fail closed and render text instead.
 *
 * KaTeX wraps its MathML in <semantics> and puts the TeX source in an
 * <annotation>. DOMPurify unwraps both by default but keeps their content, so
 * the TeX source leaks as visible text and the MathML structure breaks. They
 * are allowed explicitly; DOMPurify still sanitizes their children and
 * attributes.
 * The renderer uses ViewEncapsulation.None, so a <style> in model output would
 * restyle the whole host page; it is forbidden.
 */
function sanitizeHtml(html: string): DocumentFragment | null {
  if (!purifier?.isSupported) {
    return null;
  }
  return purifier.sanitize(html, {
    ADD_TAGS: ["semantics", "annotation"],
    FORBID_TAGS: ["style"],
    RETURN_DOM_FRAGMENT: true,
  });
}

/**
 * Tokenizes `$$...$$` display math and `$...$` inline math as markdown, so
 * math is never matched inside code spans, link targets, or other attributes.
 * A closing inline delimiter cannot be preceded by whitespace or followed by a
 * digit. Those delimiter rules keep ordinary currency ranges such as
 * "$349 ... $289" from becoming one large KaTeX expression.
 */
const mathExtension: TokenizerAndRendererExtension = {
  name: "math",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenizer(src) {
    const display = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (display) {
      return { type: "math", raw: display[0], text: display[1], display: true };
    }
    const inline = /^\$(?!\s)([^$\n]*?\S)\$(?!\d)/.exec(src);
    if (inline) {
      return { type: "math", raw: inline[0], text: inline[1], display: false };
    }
    return undefined;
  },
  renderer: (token) => {
    if (!mathRenderer) {
      // The TeX source shows until KaTeX arrives.
      void loadMath();
      return `<span class="katex-pending">${escapeHtml(token["raw"])}</span>`;
    }
    return mathRenderer(token["text"], {
      displayMode: token["display"],
      throwOnError: false,
    });
  },
};

const marked = new Marked(
  { gfm: true, breaks: true },
  { extensions: [mathExtension] },
);

/**
 * Highlights a code block in place. marked has already escaped the code and
 * its language class; the highlighted markup is sanitized before insertion.
 * Returns the fence language. Before highlight.js arrives, the code stays
 * plain text.
 */
function highlightCode(code: HTMLElement): string {
  const lang = /\blanguage-(\S+)/.exec(code.className)?.[1] ?? "";
  code.classList.add("hljs");
  if (!highlighter) {
    void loadHighlighter();
    return lang;
  }
  const language = highlighter.getLanguage(lang) ? lang : "plaintext";
  const source = (code.textContent ?? "").replace(/\n$/, "");
  const highlighted = sanitizeHtml(
    highlighter.highlight(source, { language }).value,
  );
  if (highlighted) {
    code.replaceChildren(highlighted);
  }
  return lang;
}

/**
 * Renders possibly incomplete (streaming) markdown into sanitized DOM nodes,
 * with math and highlighted code. `decorateCodeBlock` is called for each code
 * block so the caller can add its own UI around it.
 * Without a working sanitizer (for example during server rendering), returns
 * the markdown source as a string to show as text; the browser renders it
 * when it hydrates.
 */
export function renderMarkdown(
  content: string,
  decorateCodeBlock: (code: HTMLElement, language: string) => void,
): DocumentFragment | string {
  const source = completePartialMarkdown(content);
  const fragment = sanitizeHtml(marked.parse(source) as string);
  if (!fragment) {
    return source;
  }
  for (const code of Array.from(
    fragment.querySelectorAll<HTMLElement>("pre > code"),
  )) {
    decorateCodeBlock(code, highlightCode(code));
  }
  return fragment;
}
