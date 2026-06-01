<script setup lang="ts">
import { computed, h, type VNode } from "vue";
import { parseMarkdown, type MarkdownToken } from "@copilotkit/core";

const props = withDefaults(
  defineProps<{ content: string; isStreaming?: boolean }>(),
  { isStreaming: false },
);

const tokens = computed(() => parseMarkdown(props.content ?? ""));

// Allowlist URL schemes to prevent XSS via javascript:/data:/vbscript: URIs.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMG_SRC = /^(https?:|data:image\/(?!svg)|\/|\.\/|\.\.\/)/i;

function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  return SAFE_HREF.test(href.trim()) ? href : undefined;
}
function sanitizeImgSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  return SAFE_IMG_SRC.test(src.trim()) ? src : undefined;
}

function inline(toks: MarkdownToken[] | undefined): (VNode | string)[] {
  if (!toks) return [];
  return toks.map((t) => {
    switch (t.type) {
      case "text":
        return "tokens" in t && (t as any).tokens
          ? h("span", inline((t as any).tokens))
          : (t as any).text;
      case "strong":
        return h("strong", inline((t as any).tokens));
      case "em":
        return h("em", inline((t as any).tokens));
      case "del":
        return h("del", inline((t as any).tokens));
      case "codespan":
        return h(
          "code",
          { class: "cpk:rounded cpk:bg-black/5 cpk:px-1 cpk:py-0.5" },
          (t as any).text,
        );
      case "br":
        return h("br");
      case "link":
        return h(
          "a",
          {
            href: sanitizeHref((t as any).href),
            target: "_blank",
            rel: "noopener noreferrer",
          },
          (t as any).tokens ? inline((t as any).tokens) : (t as any).text,
        );
      case "image":
        return h("img", {
          src: sanitizeImgSrc((t as any).href),
          alt: (t as any).text,
          class: "cpk:max-w-full",
        });
      case "escape":
        return (t as any).text;
      default:
        return "text" in t ? (t as any).text : "";
    }
  });
}

function block(t: MarkdownToken): VNode | null {
  switch (t.type) {
    case "space":
      return null;
    case "heading": {
      const depth = Math.min(Math.max((t as any).depth, 1), 6);
      return h(`h${depth}`, inline((t as any).tokens));
    }
    case "paragraph":
      return h("p", inline((t as any).tokens));
    case "blockquote":
      return h(
        "blockquote",
        (((t as any).tokens as MarkdownToken[] | undefined) ?? [])
          .map(block)
          .filter(Boolean),
      );
    case "code":
      return h(
        "pre",
        { class: "cpk:overflow-x-auto cpk:rounded-lg cpk:p-3" },
        [h("code", { "data-language": (t as any).lang || undefined }, (t as any).text)],
      );
    case "hr":
      return h("hr");
    case "list": {
      const list = t as any;
      const items = list.items.map((it: any) =>
        h("li", ((it.tokens as MarkdownToken[] | undefined) ?? [])
          .map(block)
          .filter(Boolean)),
      );
      return list.ordered
        ? h("ol", { start: typeof list.start === "number" ? list.start : undefined }, items)
        : h("ul", items);
    }
    case "table": {
      const tbl = t as any;
      return h("div", { class: "cpk:overflow-x-auto" }, [
        h("table", [
          h("thead", [
            h(
              "tr",
              tbl.header.map((c: any) => h("th", inline(c.tokens))),
            ),
          ]),
          h(
            "tbody",
            tbl.rows.map((row: any) =>
              h(
                "tr",
                row.map((c: any) => h("td", inline(c.tokens))),
              ),
            ),
          ),
        ]),
      ]);
    }
    case "text":
      return h("p", (t as any).tokens ? inline((t as any).tokens) : (t as any).text);
    default:
      return "text" in t ? h("span", (t as any).text) : null;
  }
}

const Rendered = () =>
  h(
    "div",
    { class: "copilot-chat-assistant-markdown" },
    tokens.value.map(block).filter(Boolean),
  );
</script>

<template>
  <Rendered v-if="tokens.length" />
</template>
