import { Marked, TokenizerAndRendererExtension } from "marked";
import DOMPurify from "dompurify";
import { renderToString } from "katex";
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
  renderer: (token) =>
    renderToString(token["text"], {
      displayMode: token["display"],
      throwOnError: false,
    }),
};

const marked = new Marked(
  { gfm: true, breaks: true },
  { extensions: [mathExtension] },
);

/**
 * Gives a code block React's markup: `<pre class="cpk-markdown-code-block">`
 * around a `<code>` with the fence's info string in `data-code-info`. Like
 * React, the code is not highlighted.
 */
function toReactCodeBlock(code: HTMLElement): void {
  const info = /\blanguage-(\S+)/.exec(code.className)?.[1];
  code.removeAttribute("class");
  if (info) code.setAttribute("data-code-info", info);
  code.parentElement!.className = "cpk-markdown-code-block";
  // marked ends the code with a newline that React's renderer doesn't keep.
  const last = code.lastChild;
  if (last?.nodeType === Node.TEXT_NODE && last.textContent?.endsWith("\n")) {
    last.textContent = last.textContent.slice(0, -1);
  }
}

/**
 * Renders possibly incomplete (streaming) markdown into sanitized DOM nodes,
 * with math, and code blocks in React's markup.
 * Without a working sanitizer (for example during server rendering), returns
 * the markdown source as a string to show as text; the browser renders it
 * when it hydrates.
 */
export function renderMarkdown(content: string): DocumentFragment | string {
  const source = completePartialMarkdown(content);
  const fragment = sanitizeHtml(marked.parse(source) as string);
  if (!fragment) {
    return source;
  }
  for (const code of Array.from(
    fragment.querySelectorAll<HTMLElement>("pre > code"),
  )) {
    toReactCodeBlock(code);
  }
  return fragment;
}
