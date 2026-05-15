// rehypeCodeMeta — small rehype plugin that surfaces MDX fenced-block
// metastrings on the rendered DOM so a React `pre` override can read them.
//
// MDX supports `meta` after the language token, e.g.:
//
//     ```python title="main.py" doctest="server"
//     ...
//     ```
//
// The MDX → mdast → hast pipeline carries that metastring on the `code`
// node as `node.data.meta` (a single string). `rehype-highlight` ignores
// it entirely, so by the time MDXRemote renders, the original `title`
// has been dropped on the floor.
//
// This plugin walks every `<code>` child of a `<pre>`, parses the meta
// for `title="..."` (also tolerates single-quoted and bare values), and
// copies it onto the parent `<pre>`'s properties as `data-title`. It
// also surfaces the resolved language (`language-foo` className stripped
// to `foo`) as `data-language` so the React wrapper can show it in the
// figcaption without re-parsing classNames.
//
// Adding only data-attrs (not introducing wrapper elements) keeps the
// hast tree shape stable: any consumer that didn't override `pre` still
// gets the same output it always got.

import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import type { Plugin } from "unified";

interface CodeNodeWithMeta extends Element {
  data?: { meta?: string };
}

/**
 * Parse a single `key="value"` (or `key='value'`, or `key=value`) out of a
 * metastring. Returns the matched value or `undefined`. We deliberately
 * accept only one key here — the meta scheme isn't standardized across
 * MDX flavors, so we keep parsing minimal and predictable.
 */
function extractMetaValue(meta: string, key: string): string | undefined {
  // Double-quoted: title="main.py"
  const dq = new RegExp(`${key}="([^"]*)"`).exec(meta);
  if (dq) return dq[1];
  // Single-quoted: title='main.py'
  const sq = new RegExp(`${key}='([^']*)'`).exec(meta);
  if (sq) return sq[1];
  // Bare: title=main.py (terminates at whitespace)
  const bare = new RegExp(`${key}=([^\\s]+)`).exec(meta);
  if (bare) return bare[1];
  return undefined;
}

/**
 * Extract the resolved language hint ("python", "bash", ...) from a hast
 * `code` element's className. rehype-highlight pushes both `hljs` and
 * `language-<name>` onto the array; we want just the `<name>` part.
 */
function readLanguageFromClassName(className: unknown): string | undefined {
  if (!Array.isArray(className)) return undefined;
  for (const c of className) {
    if (typeof c !== "string") continue;
    if (c.startsWith("language-")) return c.slice("language-".length);
  }
  return undefined;
}

export const rehypeCodeMeta: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "pre") return;
      // <pre> always wraps a single <code> child in the rehype-highlight
      // shape we expect. If the shape is unexpected (e.g. an MDX author
      // wrote inline JSX into the pre), bail without touching anything.
      const codeChild = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      ) as CodeNodeWithMeta | undefined;
      if (!codeChild) return;

      const meta = codeChild.data?.meta;
      if (meta) {
        const title = extractMetaValue(meta, "title");
        if (title) {
          node.properties = node.properties || {};
          node.properties["data-title"] = title;
        }
      }
      const lang = readLanguageFromClassName(codeChild.properties?.className);
      if (lang) {
        node.properties = node.properties || {};
        node.properties["data-language"] = lang;
      }
    });
  };
};
