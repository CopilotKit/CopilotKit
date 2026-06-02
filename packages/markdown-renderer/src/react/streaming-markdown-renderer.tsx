// Derived from hashbrown "Magic Text" (MIT, © LiveLoveApp, LLC). See NOTICE.
import type {
  CitationDefinition,
  CitationState,
  StreamingMarkdownAstNode,
  StreamingMarkdownNodeType,
  StreamingMarkdownParserOptions,
  TextSegment,
} from '@copilotkit/markdown-renderer';
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useRef,
} from 'react';
import { useStreamingMarkdownParser } from './use-streaming-markdown-parser';

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
   * Optional custom renderers keyed by Magic Text node type.
   */
  nodeRenderers?: StreamingMarkdownNodeRenderers;
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
 * Custom renderer callback for a specific Magic Text node.
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
export type StreamingMarkdownCaret = boolean | ReactNode | StreamingMarkdownCaretRenderer;

type StreamingMarkdownNodeOfType<TNodeType extends StreamingMarkdownNodeType> = Extract<
  StreamingMarkdownAstNode,
  { type: TNodeType }
>;

/**
 * Supported key names for `nodeRenderers`.
 *
 * @public
 */
export type StreamingMarkdownNodeRendererKey =
  | 'node'
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'listItem'
  | 'codeBlock'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'thematicBreak'
  | 'text'
  | 'em'
  | 'strong'
  | 'strikethrough'
  | 'inlineCode'
  | 'softBreak'
  | 'hardBreak'
  | 'image'
  | 'link'
  | 'autolink'
  | 'citation';

type StreamingMarkdownNodeByRendererKey = {
  node: StreamingMarkdownAstNode;
  document: StreamingMarkdownNodeOfType<'document'>;
  paragraph: StreamingMarkdownNodeOfType<'paragraph'>;
  heading: StreamingMarkdownNodeOfType<'heading'>;
  blockquote: StreamingMarkdownNodeOfType<'blockquote'>;
  list: StreamingMarkdownNodeOfType<'list'>;
  listItem: StreamingMarkdownNodeOfType<'list-item'>;
  codeBlock: StreamingMarkdownNodeOfType<'code-block'>;
  table: StreamingMarkdownNodeOfType<'table'>;
  tableRow: StreamingMarkdownNodeOfType<'table-row'>;
  tableCell: StreamingMarkdownNodeOfType<'table-cell'>;
  thematicBreak: StreamingMarkdownNodeOfType<'thematic-break'>;
  text: StreamingMarkdownNodeOfType<'text'>;
  em: StreamingMarkdownNodeOfType<'em'>;
  strong: StreamingMarkdownNodeOfType<'strong'>;
  strikethrough: StreamingMarkdownNodeOfType<'strikethrough'>;
  inlineCode: StreamingMarkdownNodeOfType<'inline-code'>;
  softBreak: StreamingMarkdownNodeOfType<'soft-break'>;
  hardBreak: StreamingMarkdownNodeOfType<'hard-break'>;
  image: StreamingMarkdownNodeOfType<'image'>;
  link: StreamingMarkdownNodeOfType<'link'>;
  autolink: StreamingMarkdownNodeOfType<'autolink'>;
  citation: StreamingMarkdownNodeOfType<'citation'>;
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
 * Helper for creating typed Magic Text node renderer maps.
 *
 * @public
 */
export function createStreamingMarkdownNodeRenderers<T extends StreamingMarkdownNodeRenderers>(
  renderers: T,
): T {
  return renderers;
}

type RenderContext = {
  nodeById: Map<number, StreamingMarkdownAstNode>;
  citations: CitationState;
  onLinkClickRef: { current: StreamingMarkdownRendererProps['onLinkClick'] };
  onCitationClickRef: { current: StreamingMarkdownRendererProps['onCitationClick'] };
  nodeRenderers?: StreamingMarkdownNodeRenderers;
  caretTargetNodeId: number | null;
  caretNode: ReactNode;
};

type StreamingMarkdownTextNode = Extract<StreamingMarkdownAstNode, { type: 'text' }>;
type StreamingMarkdownCitationNode = Extract<StreamingMarkdownAstNode, { type: 'citation' }>;

const WORD_JOINER = '\u2060';
const DEFAULT_ROOT_CLASS = 'hb-streaming-markdown-root';
const DEFAULT_CITATION_CLASS = 'hb-streaming-markdown-citation';
const DEFAULT_CITATION_LABEL_CLASS = 'hb-streaming-markdown-citation-label';
const DEFAULT_STYLES = `
  .${DEFAULT_ROOT_CLASS} .hb-streaming-markdown-segment {
    opacity: 1;
    transition: opacity 400ms ease-out;
    @starting-style {
      opacity: 0;
    }
  }

  .${DEFAULT_ROOT_CLASS} .${DEFAULT_CITATION_CLASS} {
    vertical-align: baseline;
  }

  .${DEFAULT_ROOT_CLASS} .${DEFAULT_CITATION_LABEL_CLASS} {
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

const DEFAULT_STYLES_FALLBACK = `
  .${DEFAULT_ROOT_CLASS} .hb-streaming-markdown-segment {
    opacity: 1;
    transition: opacity 400ms ease-out;
  }

  .${DEFAULT_ROOT_CLASS} .${DEFAULT_CITATION_CLASS} {
    vertical-align: baseline;
  }

  .${DEFAULT_ROOT_CLASS} .${DEFAULT_CITATION_LABEL_CLASS} {
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

type ContainerNodeType = Extract<
  StreamingMarkdownNodeType,
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'list-item'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'em'
  | 'strong'
  | 'strikethrough'
  | 'link'
>;

const NODE_TYPE_TO_RENDERER_KEY: Record<
  StreamingMarkdownNodeType,
  StreamingMarkdownNodeRendererKey
> = {
  document: 'document',
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  list: 'list',
  'list-item': 'listItem',
  'code-block': 'codeBlock',
  table: 'table',
  'table-row': 'tableRow',
  'table-cell': 'tableCell',
  'thematic-break': 'thematicBreak',
  text: 'text',
  em: 'em',
  strong: 'strong',
  strikethrough: 'strikethrough',
  'inline-code': 'inlineCode',
  'soft-break': 'softBreak',
  'hard-break': 'hardBreak',
  image: 'image',
  link: 'link',
  autolink: 'autolink',
  citation: 'citation',
};

function renderWithOverride<TNode extends StreamingMarkdownAstNode>(
  node: TNode,
  context: RenderContext,
  defaultNode: ReactNode,
  children: ReactNode = null,
  citation?: StreamingMarkdownCitationRenderData,
): ReactNode {
  const rendererKey = NODE_TYPE_TO_RENDERER_KEY[node.type];
  const renderer = (context.nodeRenderers?.[rendererKey] ??
    context.nodeRenderers?.node) as StreamingMarkdownNodeRenderer<TNode> | undefined;

  if (!renderer) {
    return defaultNode;
  }

  return renderer({
    node,
    children,
    defaultNode,
    citation,
  });
}

function renderChildren(
  node: { children: number[] },
  context: RenderContext,
): ReactNode {
  return node.children.map((childId) => {
    const childNode = context.nodeById.get(childId);

    if (!childNode) {
      return null;
    }

    return <Fragment key={childId}>{renderNode(childNode, context)}</Fragment>;
  });
}

function renderCaret(nodeId: number, context: RenderContext): ReactNode {
  if (context.caretTargetNodeId !== nodeId) {
    return null;
  }

  return <Fragment key={`caret-${nodeId}`}>{context.caretNode}</Fragment>;
}

function renderDefaultCaret(): ReactNode {
  return (
    <span
      aria-hidden
      className="hb-streaming-markdown-caret"
      data-streaming-markdown-caret
      style={{
        display: 'inline-block',
        width: '0.48em',
        height: '0.48em',
        marginInlineStart: '0.08em',
        verticalAlign: '-0.08em',
        borderRadius: '999px',
        backgroundColor: 'currentColor',
        opacity: 0.55,
      }}
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

  if (typeof caret === 'function') {
    return caret(props);
  }

  return caret;
}

function renderTextSegments(node: StreamingMarkdownTextNode): ReactNode {
  if (node.text.length === 0) {
    return null;
  }

  if (node.segments.length === 0) {
    return (
      <span
        key={`segment-${node.id}-full`}
        className="hb-streaming-markdown-segment"
        data-streaming-markdown-segment-kind="full"
        data-streaming-markdown-whitespace="false"
      >
        {node.text}
      </span>
    );
  }

  return node.segments.map((segment: TextSegment) => (
    <span
      key={`segment-${node.id}-${segment.start}-${segment.kind}`}
      className="hb-streaming-markdown-segment"
      data-streaming-markdown-segment-kind={segment.kind}
      data-streaming-markdown-whitespace={String(segment.isWhitespace)}
    >
      {segment.noBreakBefore ? `${WORD_JOINER}${segment.text}` : segment.text}
    </span>
  ));
}

function handleLinkClick(
  context: RenderContext,
  node: StreamingMarkdownAstNode,
  url: string,
) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    context.onLinkClickRef.current?.(event, url, node);
  };
}

function getCitationRenderData(
  node: StreamingMarkdownCitationNode,
  context: RenderContext,
): StreamingMarkdownCitationRenderData {
  const number =
    node.number ?? context.citations.numbers[node.idRef] ?? node.idRef;
  const definition = context.citations.definitions[node.idRef];
  return {
    id: node.idRef,
    number,
    definition,
  } satisfies StreamingMarkdownCitationRenderData;
}

function renderDefaultCitation(
  node: StreamingMarkdownCitationNode,
  context: RenderContext,
  citation: StreamingMarkdownCitationRenderData,
): ReactNode {
  const label = String(citation.number);
  const href = citation.definition?.url;

  if (!href) {
    return (
      <sup
        key={node.id}
        className={DEFAULT_CITATION_CLASS}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        <span
          role="doc-noteref"
          className={DEFAULT_CITATION_LABEL_CLASS}
        >
          {label}
        </span>
      </sup>
    );
  }

  return (
    <sup
      key={node.id}
      className={DEFAULT_CITATION_CLASS}
      data-streaming-markdown-node={node.type}
      data-node-open={String(!node.closed)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        role="doc-noteref"
        className={DEFAULT_CITATION_LABEL_CLASS}
        onClick={(event) => {
          context.onCitationClickRef.current?.(event, citation, node);
        }}
      >
        {label}
      </a>
    </sup>
  );
}

function renderContainerNode(
  node: Extract<StreamingMarkdownAstNode, { type: ContainerNodeType }>,
  context: RenderContext,
): ReactNode {
  const children = (
    <>
      {renderChildren(node, context)}
      {renderCaret(node.id, context)}
    </>
  );

  if (node.type === 'document') {
    return renderWithOverride(
      node,
      context,
      <Fragment key={node.id}>{children}</Fragment>,
      children,
    );
  }

  if (node.type === 'paragraph') {
    const defaultNode = (
      <p
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </p>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'heading') {
    const headingTag = `h${node.level}` as const;
    const defaultNode =
      headingTag === 'h1' ? (
        <h1
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h1>
      ) : headingTag === 'h2' ? (
        <h2
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h2>
      ) : headingTag === 'h3' ? (
        <h3
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h3>
      ) : headingTag === 'h4' ? (
        <h4
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h4>
      ) : headingTag === 'h5' ? (
        <h5
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h5>
      ) : (
        <h6
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </h6>
      );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'blockquote') {
    const defaultNode = (
      <blockquote
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </blockquote>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'list') {
    if (node.ordered) {
      const defaultNode = (
        <ol
          key={node.id}
          start={node.start ?? undefined}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
          data-list-tight={String(node.tight)}
        >
          {children}
        </ol>
      );
      return renderWithOverride(node, context, defaultNode, children);
    }

    const defaultNode = (
      <ul
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
        data-list-tight={String(node.tight)}
      >
        {children}
      </ul>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'list-item') {
    const defaultNode = (
      <li
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </li>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'table') {
    const defaultNode = (
      <table
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        <tbody>{children}</tbody>
      </table>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'table-row') {
    const defaultNode = (
      <tr
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </tr>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'table-cell') {
    const parent =
      node.parentId == null ? undefined : context.nodeById.get(node.parentId);
    const isHeaderRow = parent?.type === 'table-row' && parent.isHeader;
    if (isHeaderRow) {
      const defaultNode = (
        <th
          key={node.id}
          data-streaming-markdown-node={node.type}
          data-node-open={String(!node.closed)}
        >
          {children}
        </th>
      );
      return renderWithOverride(node, context, defaultNode, children);
    }

    const defaultNode = (
      <td
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </td>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'em') {
    const defaultNode = (
      <em
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </em>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'strong') {
    const defaultNode = (
      <strong
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </strong>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'strikethrough') {
    const defaultNode = (
      <s
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {children}
      </s>
    );
    return renderWithOverride(node, context, defaultNode, children);
  }

  const defaultNode = (
    <a
      key={node.id}
      href={node.url}
      target="_blank"
      rel="noopener noreferrer"
      title={node.title}
      onClick={handleLinkClick(context, node, node.url)}
      data-streaming-markdown-node={node.type}
      data-node-open={String(!node.closed)}
    >
      {children}
    </a>
  );
  return renderWithOverride(node, context, defaultNode, children);
}

function renderNode(node: StreamingMarkdownAstNode, context: RenderContext): ReactNode {
  if (
    node.type === 'document' ||
    node.type === 'paragraph' ||
    node.type === 'heading' ||
    node.type === 'blockquote' ||
    node.type === 'list' ||
    node.type === 'list-item' ||
    node.type === 'table' ||
    node.type === 'table-row' ||
    node.type === 'table-cell' ||
    node.type === 'em' ||
    node.type === 'strong' ||
    node.type === 'strikethrough' ||
    node.type === 'link'
  ) {
    return renderContainerNode(node, context);
  }

  if (node.type === 'code-block') {
    const defaultNode = (
      <pre
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        <code data-code-info={node.info ?? undefined}>
          {node.text}
          {renderCaret(node.id, context)}
        </code>
      </pre>
    );
    return renderWithOverride(node, context, defaultNode);
  }

  if (node.type === 'thematic-break') {
    const defaultNode = (
      <hr
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      />
    );
    return renderWithOverride(node, context, defaultNode);
  }

  if (node.type === 'text') {
    const children = renderTextSegments(node);
    const defaultNode = <Fragment key={node.id}>{children}</Fragment>;
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'inline-code') {
    const defaultNode = (
      <code
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {node.text}
      </code>
    );
    return renderWithOverride(node, context, defaultNode, node.text);
  }

  if (node.type === 'soft-break') {
    const children = '\n';
    const defaultNode = <Fragment key={node.id}>{children}</Fragment>;
    return renderWithOverride(node, context, defaultNode, children);
  }

  if (node.type === 'hard-break') {
    const defaultNode = (
      <br
        key={node.id}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      />
    );
    return renderWithOverride(node, context, defaultNode);
  }

  if (node.type === 'image') {
    const defaultNode = (
      <img
        key={node.id}
        src={node.url}
        alt={node.alt}
        title={node.title}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      />
    );
    return renderWithOverride(node, context, defaultNode);
  }

  if (node.type === 'autolink') {
    const defaultNode = (
      <a
        key={node.id}
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleLinkClick(context, node, node.url)}
        data-streaming-markdown-node={node.type}
        data-node-open={String(!node.closed)}
      >
        {node.text}
      </a>
    );
    return renderWithOverride(node, context, defaultNode, node.text);
  }

  const citation = getCitationRenderData(node, context);
  const defaultNode = renderDefaultCitation(node, context, citation);
  return renderWithOverride(node, context, defaultNode, null, citation);
}

/**
 * React renderer for streaming Magic Text parser output.
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
}: StreamingMarkdownRendererProps) {
  const text = children ?? '';
  const parserState = useStreamingMarkdownParser(text, options, isComplete);
  const onLinkClickRef =
    useRef<StreamingMarkdownRendererProps['onLinkClick']>(onLinkClick);
  const onCitationClickRef =
    useRef<StreamingMarkdownRendererProps['onCitationClick']>(onCitationClick);
  onLinkClickRef.current = onLinkClick;
  onCitationClickRef.current = onCitationClick;

  const nodeById = useMemo(() => {
    const map = new Map<number, StreamingMarkdownAstNode>();

    for (const node of parserState.nodes) {
      map.set(node.id, node);
    }

    return map;
  }, [parserState.nodes]);

  const context = useMemo(() => {
    const openNode = findDeepestOpenRenderableNode(parserState.stack, nodeById);
    const caretNode = resolveCaretNode(caret, {
      isComplete: parserState.isComplete,
      openNode,
    });
    const caretTargetNodeId =
      !parserState.isComplete && openNode != null && caretNode != null
        ? openNode.id
        : null;

    return {
      nodeById,
      citations: parserState.citations,
      onLinkClickRef,
      onCitationClickRef,
      nodeRenderers,
      caretTargetNodeId,
      caretNode,
    };
  }, [
    nodeById,
    parserState.citations,
    parserState.isComplete,
    parserState.stack,
    nodeRenderers,
    caret,
  ]);

  const rootNode =
    parserState.rootId == null ? undefined : nodeById.get(parserState.rootId);
  const rootClassName = className
    ? `${DEFAULT_ROOT_CLASS} ${className}`
    : DEFAULT_ROOT_CLASS;
  const styleText =
    typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
      ? DEFAULT_STYLES_FALLBACK
      : DEFAULT_STYLES;

  if (!rootNode) {
    return (
      <>
        <style>{styleText}</style>
        <div className={rootClassName} data-streaming-markdown-root />
      </>
    );
  }

  return (
    <>
      <style>{styleText}</style>
      <div className={rootClassName} data-streaming-markdown-root>
        {renderNode(rootNode, context)}
      </div>
    </>
  );
}

function findDeepestOpenRenderableNode(
  stack: number[],
  nodeById: Map<number, StreamingMarkdownAstNode>,
): StreamingMarkdownAstNode | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const candidate = nodeById.get(stack[index]) ?? null;
    if (candidate && candidate.type !== 'document') {
      return candidate;
    }
  }

  return null;
}
