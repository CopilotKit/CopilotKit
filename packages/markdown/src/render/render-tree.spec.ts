import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "../parser/state";
import type { StreamingMarkdownParserOptions } from "../parser/types";
import { buildStreamingMarkdownRenderTree } from "./render-tree";
import type {
  StreamingMarkdownNodeClassNames,
  StreamingMarkdownRenderChild,
} from "./render-tree";

type TreeInput = {
  isComplete?: boolean;
  caret?: boolean;
  options?: Partial<StreamingMarkdownParserOptions>;
  nodeClassNames?: StreamingMarkdownNodeClassNames;
};

function tree(source: string, input: TreeInput = {}) {
  const parsed = parseStreamingMarkdownChunk(
    createStreamingMarkdownParserState({ segmenter: false, ...input.options }),
    source,
  );
  const state =
    input.isComplete === false ? parsed : finalizeStreamingMarkdown(parsed);
  return buildStreamingMarkdownRenderTree(state, {
    caret: input.caret ?? false,
    nodeClassNames: input.nodeClassNames,
  });
}

/**
 * Serializes the default output of a tree to compact HTML-like text, with
 * `^` for the caret, so assertions read like the markup they describe.
 */
function html(children: StreamingMarkdownRenderChild[], slot = ""): string {
  return children
    .map((child) => {
      switch (child.kind) {
        case "node": {
          const inner = child.children ? html(child.children) : "";
          return html(child.output, inner);
        }
        case "element": {
          const attrs = Object.entries(child.attrs)
            // Data attributes and the per-token segment class are noise here.
            .filter(
              ([name, value]) =>
                !name.startsWith("data-") &&
                value !== "cpk-streaming-markdown-segment",
            )
            .map(([name, value]) =>
              value === true ? ` ${name}` : ` ${name}="${value}"`,
            )
            .join("");
          return `<${child.tag}${attrs}>${html(child.children, slot)}</${child.tag}>`;
        }
        case "text":
          return child.text;
        case "caret":
          return "^";
        case "slot":
          return slot;
        default: {
          const unreachable: never = child;
          return unreachable;
        }
      }
    })
    .join("");
}

function render(source: string, input: TreeInput = {}) {
  const root = tree(source, input).root;
  return root ? html([root]) : null;
}

describe("buildStreamingMarkdownRenderTree", () => {
  test("returns no root when the parser state has none", () => {
    const state = { ...createStreamingMarkdownParserState(), rootId: null };
    expect(
      buildStreamingMarkdownRenderTree(state, { caret: true }).root,
    ).toBeNull();
  });

  test("renders blocks and inline nodes with GFM strikethrough as <s>", () => {
    expect(render("# T\n\n**b** ~~x~~ `c`")).toBe(
      "<h1><span>T</span></h1><p><strong><span>b</span></strong><span> </span><s><span>x</span></s><span> </span><code>c</code></p>",
    );
  });

  test("places the caret at the end of the deepest open node while streaming", () => {
    expect(render("Para **bo", { isComplete: false, caret: true })).toBe(
      "<p><span>Para </span><strong><span>bo</span>^</strong></p>",
    );
    expect(render("```\ncode", { isComplete: false, caret: true })).toBe(
      "<pre><code>code^</code></pre>",
    );
  });

  test("omits the caret once complete or when disabled", () => {
    expect(render("Para", { caret: true })).toBe("<p><span>Para</span></p>");
    expect(render("Para", { isComplete: false, caret: false })).toBe(
      "<p><span>Para</span></p>",
    );
  });

  test("drops unsafe link and image URLs and attaches click actions only to safe links", () => {
    const result = tree(
      "[a](javascript:alert(1)) [b](https://ok.example) ![i](data:image/svg+xml,x)",
    );
    expect(html(result.root ? [result.root] : [])).toBe(
      '<p><a target="_blank" rel="noopener noreferrer"><span>a</span></a><span> </span><a href="https://ok.example" target="_blank" rel="noopener noreferrer"><span>b</span></a><span> </span><img alt="i"></img></p>',
    );

    const actions: string[] = [];
    const collect = (children: StreamingMarkdownRenderChild[]) => {
      for (const child of children) {
        if (child.kind === "node") {
          collect(child.output);
          collect(child.children ?? []);
        }
        if (child.kind === "element") {
          if (child.action?.type === "link") actions.push(child.action.url);
          collect(child.children);
        }
      }
    };
    collect(result.root ? [result.root] : []);
    expect(actions).toEqual(["https://ok.example"]);
  });

  test("links a citation to its sanitized definition URL", () => {
    expect(render("See [^a]\n\n[^a]: Source https://src.example")).toBe(
      '<p><span>See </span><sup class="cpk-streaming-markdown-citation"><a href="https://src.example" target="_blank" rel="noopener noreferrer" role="doc-noteref" class="cpk-streaming-markdown-citation-label">1</a></sup></p>',
    );
  });

  test("puts a disabled checkbox at the start of a task item's text", () => {
    expect(render("- [x] done\n- [ ] todo")).toBe(
      '<ul><li><p><input type="checkbox" disabled checked></input> <span>done</span></p></li><li><p><input type="checkbox" disabled></input> <span>todo</span></p></li></ul>',
    );
  });

  test("renders math as its TeX source when enabled", () => {
    expect(render("a $x^2$", { options: { enableMath: true } })).toBe(
      "<p><span>a </span><span>x^2</span></p>",
    );
  });

  test("adds nodeClassNames to the outermost default element", () => {
    expect(
      render("```ts\nx\n```", { nodeClassNames: { codeBlock: "cb" } }),
    ).toBe('<pre class="cb"><code>x</code></pre>');
  });
});
