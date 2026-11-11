import {
  STREAMING_MARKDOWN_CARET_ATTRS,
  STREAMING_MARKDOWN_CARET_STYLE,
  STREAMING_MARKDOWN_ROOT_CLASS,
  buildStreamingMarkdownRenderTree,
  findStreamingMarkdownOpenNode,
  getStreamingMarkdownStyles,
} from "@copilotkit/markdown";
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownCitationRenderData,
  StreamingMarkdownNodeClassNames,
  StreamingMarkdownNodeRendererKey,
  StreamingMarkdownNodeType,
  StreamingMarkdownParserOptions,
  StreamingMarkdownRenderChild,
  StreamingMarkdownRenderElement,
  StreamingMarkdownRenderNode,
} from "@copilotkit/markdown";
import { Fragment, createElement, useMemo, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useStreamingMarkdownParser } from "./use-streaming-markdown-parser";

export type {
  StreamingMarkdownCitationRenderData,
  StreamingMarkdownNodeRendererKey,
} from "@copilotkit/markdown";

/**
 * Props for the `StreamingMarkdownRenderer` component.
 *
 * @public
 */
export interface StreamingMarkdownRendererProps {
  /**
   * Full markdown source that grows over time.
   */
  children: string;

  /**
   * Optional parser option overrides.
   */
  options?: Partial<StreamingMarkdownParserOptions>;

  /**
   * When `true`, finalizes the parser state after applying the latest text.
   */
  isComplete?: boolean;

  /**
   * Caret rendering behavior for streaming output.
   *
   * - `false`/`undefined`: no caret
   * - `true`: render the default caret
   * - `ReactNode`: render a custom caret node
   * - function: render a custom caret node from parser state
   */
  caret?: StreamingMarkdownCaret;

  /**
   * Optional class applied to the root element.
   */
  className?: string;

  /**
   * Called when a link or autolink is clicked.
   */
  onLinkClick?: (
    event: MouseEvent<HTMLAnchorElement>,
    url: string,
    node: StreamingMarkdownAstNode,
  ) => void;

  /**
   * Called when a citation reference is clicked.
   */
  onCitationClick?: (
    event: MouseEvent<HTMLAnchorElement>,
    citation: StreamingMarkdownCitationRenderData,
    node: StreamingMarkdownAstNode,
  ) => void;

  /**
   * Optional custom renderers keyed by streaming markdown node type.
   */
  nodeRenderers?: StreamingMarkdownNodeRenderers;

  /**
   * Extra classes for the default element of a node type, for example
   * `{ codeBlock: "my-code-block" }`.
   */
  nodeClassNames?: StreamingMarkdownNodeClassNames;
}

/**
 * Props supplied to a custom node renderer.
 *
 * @public
 */
export interface StreamingMarkdownNodeRendererProps<
  TNode extends StreamingMarkdownAstNode = StreamingMarkdownAstNode,
> {
  /**
   * The immutable AST node being rendered.
   */
  node: TNode;

  /**
   * Already-rendered child content for container nodes.
   */
  children: ReactNode;

  /**
   * Default element tree produced by `StreamingMarkdownRenderer` for this node.
   */
  defaultNode: ReactNode;

  /**
   * Citation metadata when rendering a citation node.
   */
  citation?: StreamingMarkdownCitationRenderData;
}

/**
 * Custom renderer callback for a specific streaming markdown node.
 *
 * @public
 */
export type StreamingMarkdownNodeRenderer<
  TNode extends StreamingMarkdownAstNode = StreamingMarkdownAstNode,
> = (props: StreamingMarkdownNodeRendererProps<TNode>) => ReactNode;

/**
 * Render context supplied to caret renderer callbacks.
 *
 * @public
 */
export interface StreamingMarkdownCaretRenderProps {
  /**
   * Whether the parser state is complete for the current source text.
   */
  isComplete: boolean;

  /**
   * The deepest currently open AST node, if any.
   */
  openNode: StreamingMarkdownAstNode | null;
}

/**
 * Callback type for custom caret renderers.
 *
 * @public
 */
export type StreamingMarkdownCaretRenderer = (
  props: StreamingMarkdownCaretRenderProps,
) => ReactNode;

/**
 * Supported caret prop values.
 *
 * @public
 */
export type StreamingMarkdownCaret =
  | boolean
  | ReactNode
  | StreamingMarkdownCaretRenderer;

type StreamingMarkdownNodeOfType<TNodeType extends StreamingMarkdownNodeType> =
  Extract<StreamingMarkdownAstNode, { type: TNodeType }>;

type StreamingMarkdownNodeByRendererKey = {
  node: StreamingMarkdownAstNode;
  document: StreamingMarkdownNodeOfType<"document">;
  paragraph: StreamingMarkdownNodeOfType<"paragraph">;
  heading: StreamingMarkdownNodeOfType<"heading">;
  blockquote: StreamingMarkdownNodeOfType<"blockquote">;
  list: StreamingMarkdownNodeOfType<"list">;
  listItem: StreamingMarkdownNodeOfType<"list-item">;
  codeBlock: StreamingMarkdownNodeOfType<"code-block">;
  table: StreamingMarkdownNodeOfType<"table">;
  tableRow: StreamingMarkdownNodeOfType<"table-row">;
  tableCell: StreamingMarkdownNodeOfType<"table-cell">;
  thematicBreak: StreamingMarkdownNodeOfType<"thematic-break">;
  text: StreamingMarkdownNodeOfType<"text">;
  em: StreamingMarkdownNodeOfType<"em">;
  strong: StreamingMarkdownNodeOfType<"strong">;
  strikethrough: StreamingMarkdownNodeOfType<"strikethrough">;
  inlineCode: StreamingMarkdownNodeOfType<"inline-code">;
  softBreak: StreamingMarkdownNodeOfType<"soft-break">;
  hardBreak: StreamingMarkdownNodeOfType<"hard-break">;
  image: StreamingMarkdownNodeOfType<"image">;
  link: StreamingMarkdownNodeOfType<"link">;
  autolink: StreamingMarkdownNodeOfType<"autolink">;
  citation: StreamingMarkdownNodeOfType<"citation">;
  math: StreamingMarkdownNodeOfType<"math">;
};

/**
 * Custom renderers keyed by camelCase node names.
 *
 * @public
 */
export type StreamingMarkdownNodeRenderers = Partial<{
  [TKey in StreamingMarkdownNodeRendererKey]: StreamingMarkdownNodeRenderer<
    StreamingMarkdownNodeByRendererKey[TKey]
  >;
}>;

/**
 * Helper for creating typed streaming markdown node renderer maps.
 *
 * @public
 */
export function createStreamingMarkdownNodeRenderers<
  T extends StreamingMarkdownNodeRenderers,
>(renderers: T): T {
  return renderers;
}

type RenderContext = {
  onLinkClickRef: { current: StreamingMarkdownRendererProps["onLinkClick"] };
  onCitationClickRef: {
    current: StreamingMarkdownRendererProps["onCitationClick"];
  };
  nodeRenderers?: StreamingMarkdownNodeRenderers;
  caretNode: ReactNode;
};

// The shared caret attrs use the DOM name `class`; React needs `className`.
const { class: CARET_CLASS_NAME, ...CARET_ATTRS } =
  STREAMING_MARKDOWN_CARET_ATTRS;

function renderDefaultCaret() {
  return (
    <span
      {...CARET_ATTRS}
      className={CARET_CLASS_NAME}
      style={STREAMING_MARKDOWN_CARET_STYLE}
    />
  );
}

function resolveCaretNode(
  caret: StreamingMarkdownCaret | undefined,
  props: StreamingMarkdownCaretRenderProps,
): ReactNode {
  if (caret === undefined || caret === false || caret === null) {
    return null;
  }

  if (caret === true) {
    return renderDefaultCaret();
  }

  if (typeof caret === "function") {
    return caret(props);
  }

  return caret;
}

function toReactProps(
  element: StreamingMarkdownRenderElement,
  context: RenderContext,
) {
  const props: Record<string, unknown> = { key: element.key };
  const entries = Object.entries(element.attrs);
  for (const [name, value] of entries) {
    props[name === "class" ? "className" : name] = value;
  }
  // A task-list checkbox is display-only; readOnly tells React it is
  // intentionally uncontrolled by user input.
  if (element.tag === "input") props.readOnly = true;

  const action = element.action;
  if (action?.type === "link") {
    props.onClick = (event: MouseEvent<HTMLAnchorElement>) => {
      context.onLinkClickRef.current?.(event, action.url, action.node);
    };
  }
  if (action?.type === "citation") {
    props.onClick = (event: MouseEvent<HTMLAnchorElement>) => {
      context.onCitationClickRef.current?.(event, action.citation, action.node);
    };
  }
  return props;
}

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

function renderList(
  children: StreamingMarkdownRenderChild[],
  context: RenderContext,
  slot: ReactNode,
): ReactNode[] {
  return children.map((child) => renderChild(child, context, slot));
}

/** Unwraps single-entry lists so overrides see `"text"` rather than `["text"]`. */
function collapse(nodes: ReactNode[]): ReactNode {
  return nodes.length === 1 ? nodes[0] : nodes;
}

function renderChild(
  child: StreamingMarkdownRenderChild,
  context: RenderContext,
  slot: ReactNode,
): ReactNode {
  switch (child.kind) {
    case "node":
      return renderRenderNode(child, context);
    case "element": {
      const props = toReactProps(child, context);
      return VOID_TAGS.has(child.tag)
        ? createElement(child.tag, props)
        : createElement(
            child.tag,
            props,
            ...renderList(child.children, context, slot),
          );
    }
    case "text":
      return child.text;
    case "caret":
      return <Fragment key={child.key}>{context.caretNode}</Fragment>;
    case "slot":
      return <Fragment key={child.key}>{slot}</Fragment>;
    default: {
      const unreachable: never = child;
      return unreachable;
    }
  }
}

function renderRenderNode(
  renderNode: StreamingMarkdownRenderNode,
  context: RenderContext,
): ReactNode {
  const children =
    renderNode.children === null
      ? null
      : collapse(renderList(renderNode.children, context, null));
  const defaultNode = collapse(
    renderList(renderNode.output, context, children),
  );
  const renderer = (context.nodeRenderers?.[renderNode.rendererKey] ??
    context.nodeRenderers?.node) as StreamingMarkdownNodeRenderer | undefined;

  const rendered = renderer
    ? renderer({
        node: renderNode.node,
        children,
        defaultNode,
        citation: renderNode.citation,
      })
    : defaultNode;
  return <Fragment key={renderNode.key}>{rendered}</Fragment>;
}

/**
 * React renderer for streaming markdown parser output.
 *
 * @public
 */
export function StreamingMarkdownRenderer({
  children,
  options,
  isComplete = false,
  caret,
  className,
  onLinkClick,
  onCitationClick,
  nodeRenderers,
  nodeClassNames,
}: StreamingMarkdownRendererProps) {
  const text = children ?? "";
  const parserState = useStreamingMarkdownParser(text, options, isComplete);
  const onLinkClickRef =
    useRef<StreamingMarkdownRendererProps["onLinkClick"]>(onLinkClick);
  const onCitationClickRef =
    useRef<StreamingMarkdownRendererProps["onCitationClick"]>(onCitationClick);
  onLinkClickRef.current = onLinkClick;
  onCitationClickRef.current = onCitationClick;

  const content = useMemo(() => {
    const caretNode = resolveCaretNode(caret, {
      isComplete: parserState.isComplete,
      openNode: findStreamingMarkdownOpenNode(parserState),
    });
    const tree = buildStreamingMarkdownRenderTree(parserState, {
      caret: caretNode != null,
      nodeClassNames,
    });
    if (!tree.root) return null;
    return renderRenderNode(tree.root, {
      onLinkClickRef,
      onCitationClickRef,
      nodeRenderers,
      caretNode,
    });
  }, [parserState, nodeRenderers, nodeClassNames, caret]);

  const rootClassName = className
    ? `${STREAMING_MARKDOWN_ROOT_CLASS} ${className}`
    : STREAMING_MARKDOWN_ROOT_CLASS;

  return (
    <>
      <style>{getStreamingMarkdownStyles()}</style>
      <div className={rootClassName} data-streaming-markdown-root>
        {content}
      </div>
    </>
  );
}
