import type {
  CitationDefinition,
  CitationState,
  StreamingMarkdownAstNode,
  StreamingMarkdownNodeType,
  StreamingMarkdownParserState,
  TextSegment,
} from "../parser/types";

// ---------------------------------------------------------------------------
// Public render-tree types
// ---------------------------------------------------------------------------

/**
 * Key names for per-node customization (`nodeRenderers`, `nodeClassNames`).
 * camelCase versions of the AST node types, plus `node` as a catch-all.
 *
 * @public
 */
export type StreamingMarkdownNodeRendererKey =
  | "node"
  | "document"
  | "paragraph"
  | "heading"
  | "blockquote"
  | "list"
  | "listItem"
  | "codeBlock"
  | "table"
  | "tableRow"
  | "tableCell"
  | "thematicBreak"
  | "text"
  | "em"
  | "strong"
  | "strikethrough"
  | "inlineCode"
  | "softBreak"
  | "hardBreak"
  | "image"
  | "link"
  | "autolink"
  | "citation"
  | "math";

/**
 * Metadata available when a citation node is rendered.
 *
 * @public
 */
export interface StreamingMarkdownCitationRenderData {
  id: string;
  number: number | string;
  definition?: CitationDefinition;
}

/**
 * Extra class names for the outermost default element of a node type, for
 * example `{ codeBlock: "cpk-markdown-code-block" }`. Ignored for node types
 * that render no element of their own (`document`, `text`, `softBreak`).
 *
 * @public
 */
export type StreamingMarkdownNodeClassNames = Partial<
  Record<StreamingMarkdownNodeRendererKey, string>
>;

/**
 * Click behavior a backend attaches to a rendered element.
 *
 * @public
 */
export type StreamingMarkdownRenderAction =
  | { type: "link"; url: string; node: StreamingMarkdownAstNode }
  | {
      type: "citation";
      citation: StreamingMarkdownCitationRenderData;
      node: StreamingMarkdownAstNode;
    };

/**
 * A plain element. Attribute values are already sanitized; `true` marks a
 * boolean attribute that is present.
 *
 * @public
 */
export interface StreamingMarkdownRenderElement {
  kind: "element";
  key: string;
  tag: string;
  attrs: Readonly<Record<string, string | true>>;
  children: StreamingMarkdownRenderChild[];
  action?: StreamingMarkdownRenderAction;
}

/**
 * A text run.
 *
 * @public
 */
export interface StreamingMarkdownRenderText {
  kind: "text";
  key: string;
  text: string;
}

/**
 * Where the streaming caret goes. The backend decides what the caret looks like.
 *
 * @public
 */
export interface StreamingMarkdownRenderCaret {
  kind: "caret";
  key: string;
}

/**
 * Placeholder inside a node's default `output` that stands for its `children`.
 *
 * @public
 */
export interface StreamingMarkdownRenderSlot {
  kind: "slot";
  key: string;
}

/**
 * One AST node, ready to render. Backends render `children` once, render
 * `output` with every `slot` replaced by those children, and pass both to a
 * custom node renderer when one is registered for `rendererKey`.
 *
 * @public
 */
export interface StreamingMarkdownRenderNode {
  kind: "node";
  key: string;
  node: StreamingMarkdownAstNode;
  rendererKey: StreamingMarkdownNodeRendererKey;
  /** Content a custom renderer receives as its children; `null` for leaves. */
  children: StreamingMarkdownRenderChild[] | null;
  /** The default rendering. */
  output: StreamingMarkdownRenderChild[];
  /** `true` when the caret renders somewhere inside this node. */
  containsCaret: boolean;
  citation?: StreamingMarkdownCitationRenderData;
}

/**
 * Any entry in a render tree.
 *
 * @public
 */
export type StreamingMarkdownRenderChild =
  | StreamingMarkdownRenderNode
  | StreamingMarkdownRenderElement
  | StreamingMarkdownRenderText
  | StreamingMarkdownRenderCaret
  | StreamingMarkdownRenderSlot;

/**
 * Options for {@link buildStreamingMarkdownRenderTree}.
 *
 * @public
 */
export interface StreamingMarkdownRenderTreeOptions {
  /** Render a caret inside the deepest open node while streaming. */
  caret: boolean;
  nodeClassNames?: StreamingMarkdownNodeClassNames;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * Class on the root element every renderer emits.
 * @public
 */
export const STREAMING_MARKDOWN_ROOT_CLASS = "cpk-streaming-markdown-root";

/**
 * Node classes CopilotKit's built-in chat markdown renderers (React, Vue,
 * Angular) apply, so all three emit the same themed markup.
 * @public
 */
export const CHAT_MARKDOWN_NODE_CLASS_NAMES = {
  codeBlock: "cpk-markdown-code-block",
} as const satisfies StreamingMarkdownNodeClassNames;

const SEGMENT_CLASS = "cpk-streaming-markdown-segment";
const CITATION_CLASS = "cpk-streaming-markdown-citation";
const CITATION_LABEL_CLASS = "cpk-streaming-markdown-citation-label";
const WORD_JOINER = "⁠";

/**
 * Attributes of the default caret element.
 * @public
 */
export const STREAMING_MARKDOWN_CARET_ATTRS = {
  "aria-hidden": "true",
  class: "cpk-streaming-markdown-caret",
  "data-streaming-markdown-caret": "true",
} as const;

/**
 * Inline style of the default caret element (camelCase CSS properties).
 * @public
 */
export const STREAMING_MARKDOWN_CARET_STYLE = {
  display: "inline-block",
  width: "0.48em",
  height: "0.48em",
  marginInlineStart: "0.08em",
  verticalAlign: "-0.08em",
  borderRadius: "999px",
  backgroundColor: "currentColor",
  opacity: "0.55",
} as const;

const CITATION_STYLES = `
  .${STREAMING_MARKDOWN_ROOT_CLASS} .${CITATION_CLASS} {
    vertical-align: baseline;
  }

  .${STREAMING_MARKDOWN_ROOT_CLASS} .${CITATION_LABEL_CLASS} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.4em;
    block-size: 1.4em;
    border-radius: 999px;
    border: 1px solid hsl(0 0% 50% / 0.35);
    background-color: hsl(0 0% 50% / 0.16);
    color: inherit;
    font-size: 0.7em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    transform: translateY(-0.15em);
  }
`;

const SEGMENT_FADE_IN_STYLES = `
  .${STREAMING_MARKDOWN_ROOT_CLASS} .${SEGMENT_CLASS} {
    opacity: 1;
    transition: opacity 400ms ease-out;
    @starting-style {
      opacity: 0;
    }
  }
`;

// jsdom's CSS parser rejects nested `@starting-style`, so tests get the same
// rules without the fade-in start state.
const SEGMENT_FALLBACK_STYLES = `
  .${STREAMING_MARKDOWN_ROOT_CLASS} .${SEGMENT_CLASS} {
    opacity: 1;
    transition: opacity 400ms ease-out;
  }
`;

/**
 * Stylesheet every renderer injects next to its root: the per-token fade-in
 * for text segments and the citation pill. Read at render time, so it is safe
 * to call during server rendering.
 *
 * @public
 */
export function getStreamingMarkdownStyles() {
  const isJsdom =
    typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  return (
    (isJsdom ? SEGMENT_FALLBACK_STYLES : SEGMENT_FADE_IN_STYLES) +
    CITATION_STYLES
  );
}

// ---------------------------------------------------------------------------
// URL sanitization
// ---------------------------------------------------------------------------

// Only http(s), mailto, tel, relative and anchor hrefs, and non-SVG
// data:image/* image sources are allowed. Anything else (javascript:,
// data:text/html, data:image/svg+xml, vbscript:, …) is dropped.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMG_SRC = /^(https?:|data:image\/(?!svg)|\/|\.\/|\.\.\/)/i;

/**
 * Returns `href` when its scheme is allowed for links, else `undefined`.
 * @public
 */
export function sanitizeStreamingMarkdownHref(href: string | undefined) {
  if (!href) return undefined;
  return SAFE_HREF.test(href.trim()) ? href : undefined;
}

/**
 * Returns `src` when its scheme is allowed for images, else `undefined`.
 * @public
 */
export function sanitizeStreamingMarkdownImageSrc(src: string | undefined) {
  if (!src) return undefined;
  return SAFE_IMG_SRC.test(src.trim()) ? src : undefined;
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

const RENDERER_KEY_BY_NODE_TYPE: Record<
  StreamingMarkdownNodeType,
  StreamingMarkdownNodeRendererKey
> = {
  document: "document",
  paragraph: "paragraph",
  heading: "heading",
  blockquote: "blockquote",
  list: "list",
  "list-item": "listItem",
  "code-block": "codeBlock",
  table: "table",
  "table-row": "tableRow",
  "table-cell": "tableCell",
  "thematic-break": "thematicBreak",
  text: "text",
  em: "em",
  strong: "strong",
  strikethrough: "strikethrough",
  "inline-code": "inlineCode",
  "soft-break": "softBreak",
  "hard-break": "hardBreak",
  image: "image",
  link: "link",
  autolink: "autolink",
  citation: "citation",
  math: "math",
};

type NodeById = ReadonlyMap<number, StreamingMarkdownAstNode>;

type BuildContext = {
  nodeById: NodeById;
  citations: CitationState;
  caretTargetNodeId: number | null;
  caretPath: ReadonlySet<number>;
  nodeClassNames: StreamingMarkdownNodeClassNames | undefined;
};

type TextNode = Extract<StreamingMarkdownAstNode, { type: "text" }>;
type CitationNode = Extract<StreamingMarkdownAstNode, { type: "citation" }>;

const SLOT: StreamingMarkdownRenderSlot = { kind: "slot", key: "slot" };

function indexNodes(state: StreamingMarkdownParserState): NodeById {
  return new Map(state.nodes.map((node) => [node.id, node]));
}

function findOpenNode(stack: number[], nodeById: NodeById) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const candidate = nodeById.get(stack[index]);
    if (candidate && candidate.type !== "document") {
      return candidate;
    }
  }
  return null;
}

/**
 * The deepest open (still streaming) node other than the document, or `null`.
 * This is where the caret goes.
 *
 * @public
 */
export function findStreamingMarkdownOpenNode(
  state: StreamingMarkdownParserState,
) {
  return findOpenNode(state.stack, indexNodes(state));
}

/**
 * Citation number and definition for a citation node.
 *
 * @public
 */
export function getStreamingMarkdownCitationData(
  node: CitationNode,
  citations: CitationState,
): StreamingMarkdownCitationRenderData {
  return {
    id: node.idRef,
    number: node.number ?? citations.numbers[node.idRef] ?? node.idRef,
    definition: citations.definitions[node.idRef],
  };
}

function nodeAttrs(
  node: StreamingMarkdownAstNode,
  context: BuildContext,
  extra: Record<string, string | true | undefined> = {},
) {
  const attrs: Record<string, string | true> = {};
  const className =
    context.nodeClassNames?.[RENDERER_KEY_BY_NODE_TYPE[node.type]];
  if (className) attrs.class = className;
  const entries = Object.entries(extra);
  for (const [name, value] of entries) {
    if (value !== undefined) attrs[name] = value;
  }
  attrs["data-streaming-markdown-node"] = node.type;
  attrs["data-node-open"] = String(!node.closed);
  return attrs;
}

function element(
  key: string,
  tag: string,
  attrs: Readonly<Record<string, string | true>>,
  children: StreamingMarkdownRenderChild[],
  action?: StreamingMarkdownRenderAction,
): StreamingMarkdownRenderElement {
  return action
    ? { kind: "element", key, tag, attrs, children, action }
    : { kind: "element", key, tag, attrs, children };
}

function text(key: string, value: string): StreamingMarkdownRenderText {
  return { kind: "text", key, text: value };
}

function caretFor(
  nodeId: number,
  context: BuildContext,
): StreamingMarkdownRenderCaret[] {
  return context.caretTargetNodeId === nodeId
    ? [{ kind: "caret", key: `caret-${nodeId}` }]
    : [];
}

function renderNode(
  node: StreamingMarkdownAstNode,
  context: BuildContext,
  children: StreamingMarkdownRenderChild[] | null,
  output: StreamingMarkdownRenderChild[],
  citation?: StreamingMarkdownCitationRenderData,
): StreamingMarkdownRenderNode {
  const base: StreamingMarkdownRenderNode = {
    kind: "node",
    key: String(node.id),
    node,
    rendererKey: RENDERER_KEY_BY_NODE_TYPE[node.type],
    children,
    output,
    containsCaret: context.caretPath.has(node.id),
  };
  return citation ? { ...base, citation } : base;
}

function containerChildren(
  node: { id: number; children: number[] },
  context: BuildContext,
) {
  const built = node.children.flatMap((childId) => {
    const child = context.nodeById.get(childId);
    return child ? [buildNode(child, context)] : [];
  });
  return [...built, ...caretFor(node.id, context)];
}

/** A container whose default output is one element wrapping its children. */
function wrapped(
  node: Extract<StreamingMarkdownAstNode, { children: number[] }>,
  context: BuildContext,
  tag: string,
  extra: Record<string, string | true | undefined> = {},
  action?: StreamingMarkdownRenderAction,
) {
  const attrs = nodeAttrs(node, context, extra);
  return renderNode(node, context, containerChildren(node, context), [
    element(String(node.id), tag, attrs, [SLOT], action),
  ]);
}

function textSegments(node: TextNode): StreamingMarkdownRenderChild[] {
  if (node.text.length === 0) {
    return [];
  }

  if (node.segments.length === 0) {
    return [
      element(
        `segment-${node.id}-full`,
        "span",
        {
          class: SEGMENT_CLASS,
          "data-streaming-markdown-segment-kind": "full",
          "data-streaming-markdown-whitespace": "false",
        },
        [text("text", node.text)],
      ),
    ];
  }

  return node.segments.map((segment: TextSegment) =>
    element(
      `segment-${node.id}-${segment.start}-${segment.kind}`,
      "span",
      {
        class: SEGMENT_CLASS,
        "data-streaming-markdown-segment-kind": segment.kind,
        "data-streaming-markdown-whitespace": String(segment.isWhitespace),
      },
      [
        text(
          "text",
          segment.noBreakBefore
            ? `${WORD_JOINER}${segment.text}`
            : segment.text,
        ),
      ],
    ),
  );
}

function taskCheckbox(
  node: StreamingMarkdownAstNode,
  context: BuildContext,
): StreamingMarkdownRenderChild[] {
  const parent =
    node.parentId == null ? undefined : context.nodeById.get(node.parentId);
  const isFirstParagraphOfTask =
    parent?.type === "list-item" &&
    parent.checked !== undefined &&
    parent.children[0] === node.id;
  if (!isFirstParagraphOfTask) {
    return [];
  }
  const attrs: Record<string, string | true> = {
    type: "checkbox",
    disabled: true,
    "data-streaming-markdown-task": "true",
  };
  if (parent.checked) attrs.checked = true;
  return [
    element(`task-${parent.id}`, "input", attrs, []),
    text("task-space", " "),
  ];
}

function buildCitation(node: CitationNode, context: BuildContext) {
  const citation = getStreamingMarkdownCitationData(node, context.citations);
  const label = [text("label", String(citation.number))];
  const href = sanitizeStreamingMarkdownHref(citation.definition?.url);
  const inner = href
    ? element(
        "label",
        "a",
        {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          role: "doc-noteref",
          class: CITATION_LABEL_CLASS,
        },
        label,
        { type: "citation", citation, node },
      )
    : element(
        "label",
        "span",
        { role: "doc-noteref", class: CITATION_LABEL_CLASS },
        label,
      );
  const attrs = nodeAttrs(node, context);
  const supClass = attrs.class
    ? `${CITATION_CLASS} ${attrs.class}`
    : CITATION_CLASS;
  return renderNode(
    node,
    context,
    null,
    [element(String(node.id), "sup", { ...attrs, class: supClass }, [inner])],
    citation,
  );
}

function buildNode(
  node: StreamingMarkdownAstNode,
  context: BuildContext,
): StreamingMarkdownRenderNode {
  const key = String(node.id);

  switch (node.type) {
    case "document":
      return renderNode(node, context, containerChildren(node, context), [
        SLOT,
      ]);
    case "paragraph": {
      const attrs = nodeAttrs(node, context);
      return renderNode(node, context, containerChildren(node, context), [
        element(key, "p", attrs, [...taskCheckbox(node, context), SLOT]),
      ]);
    }
    case "heading":
      return wrapped(node, context, `h${node.level}`);
    case "blockquote":
      return wrapped(node, context, "blockquote");
    case "list":
      return wrapped(node, context, node.ordered ? "ol" : "ul", {
        start:
          node.ordered && node.start != null ? String(node.start) : undefined,
        "data-list-tight": String(node.tight),
      });
    case "list-item":
      return wrapped(node, context, "li");
    case "table": {
      const attrs = nodeAttrs(node, context);
      return renderNode(node, context, containerChildren(node, context), [
        element(key, "table", attrs, [element("tbody", "tbody", {}, [SLOT])]),
      ]);
    }
    case "table-row":
      return wrapped(node, context, "tr");
    case "table-cell": {
      const parent =
        node.parentId == null ? undefined : context.nodeById.get(node.parentId);
      const isHeaderRow = parent?.type === "table-row" && parent.isHeader;
      return wrapped(node, context, isHeaderRow ? "th" : "td");
    }
    case "em":
      return wrapped(node, context, "em");
    case "strong":
      return wrapped(node, context, "strong");
    case "strikethrough":
      return wrapped(node, context, "s");
    case "link": {
      const href = sanitizeStreamingMarkdownHref(node.url);
      return wrapped(
        node,
        context,
        "a",
        {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          title: node.title,
        },
        href ? { type: "link", url: href, node } : undefined,
      );
    }
    case "code-block": {
      const attrs = nodeAttrs(node, context);
      const codeAttrs: Record<string, string> = node.info
        ? { "data-code-info": node.info }
        : {};
      return renderNode(node, context, null, [
        element(key, "pre", attrs, [
          element("code", "code", codeAttrs, [
            text("text", node.text),
            ...caretFor(node.id, context),
          ]),
        ]),
      ]);
    }
    case "thematic-break":
      return renderNode(node, context, null, [
        element(key, "hr", nodeAttrs(node, context), []),
      ]);
    case "hard-break":
      return renderNode(node, context, null, [
        element(key, "br", nodeAttrs(node, context), []),
      ]);
    case "text":
      return renderNode(node, context, textSegments(node), [SLOT]);
    case "soft-break":
      return renderNode(node, context, [text("text", "\n")], [SLOT]);
    case "inline-code":
      return renderNode(
        node,
        context,
        [text("text", node.text)],
        [element(key, "code", nodeAttrs(node, context), [SLOT])],
      );
    case "image":
      return renderNode(node, context, null, [
        element(
          key,
          "img",
          nodeAttrs(node, context, {
            src: sanitizeStreamingMarkdownImageSrc(node.url),
            alt: node.alt,
            title: node.title,
          }),
          [],
        ),
      ]);
    case "autolink": {
      const href = sanitizeStreamingMarkdownHref(node.url);
      return renderNode(
        node,
        context,
        [text("text", node.text)],
        [
          element(
            key,
            "a",
            nodeAttrs(node, context, {
              href,
              target: "_blank",
              rel: "noopener noreferrer",
            }),
            [SLOT],
            href ? { type: "link", url: href, node } : undefined,
          ),
        ],
      );
    }
    case "math":
      return renderNode(
        node,
        context,
        [text("text", node.text)],
        [
          element(
            key,
            "span",
            nodeAttrs(node, context, {
              "data-math-display": String(node.display),
            }),
            [SLOT],
          ),
        ],
      );
    case "citation":
      return buildCitation(node, context);
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/**
 * Turns parser state into a framework-neutral render tree: which elements to
 * create, their sanitized attributes, click actions, text segments for the
 * per-token animation, and where the caret goes. The React, Vue, and DOM
 * renderers all render this tree, so markup and sanitization live here only.
 *
 * @param state - Parser state from the streaming markdown parser.
 * @param options - Whether to place a caret, and optional per-node classes.
 * @returns The root render node (`null` when the state has no root) and the
 * open node the caret targets.
 * @public
 */
export function buildStreamingMarkdownRenderTree(
  state: StreamingMarkdownParserState,
  options: StreamingMarkdownRenderTreeOptions,
) {
  const nodeById = indexNodes(state);
  const openNode = findOpenNode(state.stack, nodeById);
  const caretTargetNodeId =
    options.caret && !state.isComplete && openNode ? openNode.id : null;

  const caretPath = new Set<number>();
  let cursor =
    caretTargetNodeId == null ? undefined : nodeById.get(caretTargetNodeId);
  while (cursor) {
    caretPath.add(cursor.id);
    cursor =
      cursor.parentId == null ? undefined : nodeById.get(cursor.parentId);
  }

  const context: BuildContext = {
    nodeById,
    citations: state.citations,
    caretTargetNodeId,
    caretPath,
    nodeClassNames: options.nodeClassNames,
  };
  const rootNode =
    state.rootId == null ? undefined : nodeById.get(state.rootId);

  return {
    root: rootNode ? buildNode(rootNode, context) : null,
    openNode,
    isComplete: state.isComplete,
  };
}

/**
 * The render tree produced by {@link buildStreamingMarkdownRenderTree}.
 * @public
 */
export type StreamingMarkdownRenderTree = ReturnType<
  typeof buildStreamingMarkdownRenderTree
>;
