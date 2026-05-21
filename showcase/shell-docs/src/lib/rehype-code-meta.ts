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
// The transformer pushes `meta.title` onto `pre.properties["data-title"]`
// and the resolved Shiki language onto `pre.properties["data-language"]`
// so React reads them via the standard `data-*` prop bridge.

import type { ShikiTransformer } from "shiki";

interface ShikiMeta {
  title?: string;
}

export function transformerMeta(): ShikiTransformer {
  return {
    name: "shell-docs:meta-passthrough",
    pre(node) {
      const meta = this.options.meta as ShikiMeta | undefined;
      if (meta?.title) {
        node.properties = node.properties || {};
        node.properties["data-title"] = meta.title;
      }
      if (this.options.lang) {
        node.properties = node.properties || {};
        node.properties["data-language"] = this.options.lang;
      }
      return node;
    },
  };
}
