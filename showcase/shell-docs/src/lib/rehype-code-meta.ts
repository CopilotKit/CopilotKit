// transformerMeta — Shiki transformer that surfaces the parsed fence
// meta (`title="..."`) and the resolved language as data-attrs on the
// emitted `<pre>` so React `pre` overrides can read them.
//
// rehype-code (Fumadocs's wrapper around @shikijs/rehype) parses the
// MDX fence metastring via `parseCodeBlockAttributes`, picking out
// keys like `title` and `tab` into a `meta` object that's passed to
// Shiki transformers via `this.options.meta`. Shiki then emits a
// freshly-built `<pre>` and discards everything that was on the
// original mdast/hast `<code>` node — including `data.meta`. Without
// this transformer, our `<MdxCodeBlock>` `pre` override has no way to
// see the author's `title="main.py"` value.
//
// The transformer pushes `meta.title`, the resolved Shiki language, and the
// original source onto the `<pre>`. `MdxCodeBlock` consumes (and does not
// forward) the source prop. Keeping the source as one string is important:
// production React Server Component serialization can stream the highlighted
// child tree in chunks, so reconstructing source by walking those children can
// observe only the first chunk during hydration.

import type { ShikiTransformer } from "shiki";

interface ShikiMeta {
  title?: string;
}

export function transformerMeta(): ShikiTransformer {
  return {
    name: "shell-docs:meta-passthrough",
    pre(node) {
      const meta = this.options.meta as ShikiMeta | undefined;
      node.properties = node.properties || {};
      node.properties["data-raw-code"] = this.source;
      if (meta?.title) {
        node.properties["data-title"] = meta.title;
      }
      if (this.options.lang) {
        node.properties["data-language"] = this.options.lang;
      }
      return node;
    },
  };
}
