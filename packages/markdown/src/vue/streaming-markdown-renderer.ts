import { computed, defineComponent, h, isVNode } from "vue";
import type { PropType, VNode, VNodeChild } from "vue";
import {
  STREAMING_MARKDOWN_CARET_ATTRS,
  STREAMING_MARKDOWN_CARET_STYLE,
  STREAMING_MARKDOWN_ROOT_CLASS,
  buildStreamingMarkdownRenderTree,
  getStreamingMarkdownStyles,
  updateStreamingMarkdownParserSession,
} from "@copilotkit/markdown";
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownCitationRenderData,
  StreamingMarkdownNodeClassNames,
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserSession,
  StreamingMarkdownRenderChild,
  StreamingMarkdownRenderElement,
  StreamingMarkdownRenderNode,
} from "@copilotkit/markdown";

// ---------------------------------------------------------------------------
// Vue component props types (exported for consumer use)
// ---------------------------------------------------------------------------

/**
 * Custom Vue render function for a specific AST node.
 * @public
 */
export type VueStreamingMarkdownNodeRenderer = (
  node: StreamingMarkdownAstNode,
  defaultVNode: VNode | string | null,
) => VNode | string | null;

/**
 * Supported key names for Vue `nodeRenderers`.
 * CamelCase, matching `StreamingMarkdownNodeRendererKey` on the React renderer.
 *
 * @public
 */
export type VueStreamingMarkdownNodeRendererKey =
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
  | "em"
  | "strong"
  | "strikethrough"
  | "inlineCode"
  | "hardBreak"
  | "image"
  | "link"
  | "autolink"
  | "citation"
  | "math";

/**
 * Optional map of node-type renderer keys to custom Vue render functions.
 * @public
 */
export type VueStreamingMarkdownNodeRenderers = Partial<
  Record<VueStreamingMarkdownNodeRendererKey, VueStreamingMarkdownNodeRenderer>
>;

/**
 * Called when a link or autolink is clicked.
 * @public
 */
export type VueStreamingMarkdownLinkClickHandler = (
  event: MouseEvent,
  url: string,
  node: StreamingMarkdownAstNode,
) => void;

/**
 * Called when a citation reference is clicked.
 * @public
 */
export type VueStreamingMarkdownCitationClickHandler = (
  event: MouseEvent,
  citation: StreamingMarkdownCitationRenderData,
  node: StreamingMarkdownAstNode,
) => void;

// ---------------------------------------------------------------------------
// Render tree → VNodes
// ---------------------------------------------------------------------------

type RenderContext = {
  nodeRenderers: VueStreamingMarkdownNodeRenderers | undefined;
  onLinkClick: VueStreamingMarkdownLinkClickHandler | undefined;
  onCitationClick: VueStreamingMarkdownCitationClickHandler | undefined;
};

const VUE_RENDERER_KEYS = new Set<string>([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "thematicBreak",
  "em",
  "strong",
  "strikethrough",
  "inlineCode",
  "hardBreak",
  "image",
  "link",
  "autolink",
  "citation",
  "math",
] satisfies VueStreamingMarkdownNodeRendererKey[]);

function isVueRendererKey(
  key: string,
): key is VueStreamingMarkdownNodeRendererKey {
  return VUE_RENDERER_KEYS.has(key);
}

function elementProps(
  element: StreamingMarkdownRenderElement,
  context: RenderContext,
) {
  const props: Record<string, unknown> = { key: element.key, ...element.attrs };
  const action = element.action;
  if (action?.type === "link") {
    props.onClick = (event: MouseEvent) =>
      context.onLinkClick?.(event, action.url, action.node);
  }
  if (action?.type === "citation") {
    props.onClick = (event: MouseEvent) =>
      context.onCitationClick?.(event, action.citation, action.node);
  }
  return props;
}

function renderChild(
  child: StreamingMarkdownRenderChild,
  context: RenderContext,
  slot: VNodeChild[],
): VNodeChild | VNodeChild[] {
  switch (child.kind) {
    case "node":
      return renderRenderNode(child, context);
    case "element":
      return h(
        child.tag,
        elementProps(child, context),
        child.children.flatMap((entry) => renderChild(entry, context, slot)),
      );
    case "text":
      return child.text;
    case "caret":
      return h("span", {
        key: child.key,
        ...STREAMING_MARKDOWN_CARET_ATTRS,
        style: STREAMING_MARKDOWN_CARET_STYLE,
      });
    case "slot":
      return slot;
    default: {
      const unreachable: never = child;
      return unreachable;
    }
  }
}

function renderRenderNode(
  renderNode: StreamingMarkdownRenderNode,
  context: RenderContext,
): VNodeChild[] {
  const children = (renderNode.children ?? []).flatMap((entry) =>
    renderChild(entry, context, []),
  );
  const output = renderNode.output.flatMap((entry) =>
    renderChild(entry, context, children),
  );
  const key = renderNode.rendererKey;
  const override = isVueRendererKey(key)
    ? context.nodeRenderers?.[key]
    : undefined;
  if (!override) {
    return output;
  }
  const [first] = output;
  const defaultVNode =
    isVNode(first) || typeof first === "string" ? first : null;
  return [override(renderNode.node, defaultVNode)];
}

// ---------------------------------------------------------------------------
// StreamingMarkdownRenderer — Vue 3 Composition API component (.ts)
// ---------------------------------------------------------------------------

/**
 * Vue 3 streaming markdown renderer.
 *
 * Parses with `@copilotkit/markdown` and renders the shared render tree with
 * `h()`, so markup, sanitization, caret placement, and the per-token fade-in
 * match the React and DOM renderers.
 *
 * @public
 */
export const StreamingMarkdownRenderer = defineComponent({
  name: "StreamingMarkdownRenderer",
  inheritAttrs: false,

  props: {
    /** The full markdown source string, which may grow over time during streaming. */
    content: {
      type: String as PropType<string>,
      required: true,
    },
    /** When true, finalizes the parser state (end of stream). */
    isComplete: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
    /** Optional parser option overrides. */
    options: {
      type: Object as PropType<Partial<StreamingMarkdownParserOptions>>,
      default: undefined,
    },
    /** Optional CSS class applied to the root wrapper element. */
    class: {
      type: String as PropType<string>,
      default: undefined,
    },
    /**
     * When true, renders a caret inside the deepest open node while streaming.
     */
    caret: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
    /**
     * Optional map of node-type keys to custom Vue render functions.
     * Each function receives the AST node and the default VNode and can return
     * a replacement VNode (or the defaultVNode to keep the default).
     */
    nodeRenderers: {
      type: Object as PropType<VueStreamingMarkdownNodeRenderers>,
      default: undefined,
    },
    /** Extra classes for the default element of a node type. */
    nodeClassNames: {
      type: Object as PropType<StreamingMarkdownNodeClassNames>,
      default: undefined,
    },
    /** Called when a link or autolink is clicked. */
    onLinkClick: {
      type: Function as PropType<VueStreamingMarkdownLinkClickHandler>,
      default: undefined,
    },
    /** Called when a citation reference with a URL is clicked. */
    onCitationClick: {
      type: Function as PropType<VueStreamingMarkdownCitationClickHandler>,
      default: undefined,
    },
  },

  setup(props, { attrs }) {
    // Not reactive on purpose: the previous session only seeds the next parse.
    let session: StreamingMarkdownParserSession | null = null;
    const parserState = computed(() => {
      session = updateStreamingMarkdownParserSession(
        session,
        props.content ?? "",
        props.options,
        props.isComplete,
      );
      return session.parserState;
    });

    return () => {
      const tree = buildStreamingMarkdownRenderTree(parserState.value, {
        caret: props.caret,
        nodeClassNames: props.nodeClassNames,
      });
      const content = tree.root
        ? renderRenderNode(tree.root, {
            nodeRenderers: props.nodeRenderers,
            onLinkClick: props.onLinkClick,
            onCitationClick: props.onCitationClick,
          })
        : [];

      const rootClass = props.class
        ? `${STREAMING_MARKDOWN_ROOT_CLASS} ${props.class}`
        : STREAMING_MARKDOWN_ROOT_CLASS;

      return [
        h("style", getStreamingMarkdownStyles()),
        h(
          "div",
          { ...attrs, class: rootClass, "data-streaming-markdown-root": true },
          content,
        ),
      ];
    };
  },
});
