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
  StreamingMarkdownNodeRendererKey,
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserSession,
  StreamingMarkdownRenderAction,
  StreamingMarkdownRenderChild,
  StreamingMarkdownRenderNode,
} from "@copilotkit/markdown";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Props supplied to a custom DOM node renderer.
 *
 * @public
 */
export interface StreamingMarkdownDomNodeRendererProps {
  /** The immutable AST node being rendered. */
  node: StreamingMarkdownAstNode;
  /** Freshly rendered child content for container nodes; `null` for leaves. */
  children: Node[] | null;
  /** Freshly rendered default element for this node. */
  defaultNode: Node | null;
  /** Citation metadata when rendering a citation node. */
  citation?: StreamingMarkdownCitationRenderData;
  /** Document to create nodes with (the container's owner document). */
  document: Document;
}

/**
 * Custom renderer for one node type. Return the node to insert, or `null`
 * to render nothing.
 *
 * @public
 */
export type StreamingMarkdownDomNodeRenderer = (
  props: StreamingMarkdownDomNodeRendererProps,
) => Node | null;

/**
 * Custom DOM renderers keyed by camelCase node names (`node` is a catch-all).
 *
 * @public
 */
export type StreamingMarkdownDomNodeRenderers = Partial<
  Record<StreamingMarkdownNodeRendererKey, StreamingMarkdownDomNodeRenderer>
>;

/**
 * Inputs for one render. Pass the full set every time, like component props.
 *
 * @public
 */
export interface StreamingMarkdownDomRenderProps {
  /** Full markdown source that grows over time. */
  content: string;
  /** `true` once the source is final; hides the caret. */
  isComplete?: boolean;
  /** Parser option overrides. */
  options?: Partial<StreamingMarkdownParserOptions>;
  /** Render the default streaming caret inside the deepest open node. */
  caret?: boolean;
  /** Extra class on the root element. */
  className?: string;
  /** Called when a link or autolink is clicked. */
  onLinkClick?: (
    event: MouseEvent,
    url: string,
    node: StreamingMarkdownAstNode,
  ) => void;
  /** Called when a citation reference with a URL is clicked. */
  onCitationClick?: (
    event: MouseEvent,
    citation: StreamingMarkdownCitationRenderData,
    node: StreamingMarkdownAstNode,
  ) => void;
  /** Custom renderers keyed by node type. */
  nodeRenderers?: StreamingMarkdownDomNodeRenderers;
  /** Extra classes for the default element of a node type. */
  nodeClassNames?: StreamingMarkdownNodeClassNames;
}

// ---------------------------------------------------------------------------
// Virtual nodes
// ---------------------------------------------------------------------------

type VElement = {
  kind: "element";
  key: string;
  tag: string;
  attrs: Readonly<Record<string, string | true>>;
  action?: StreamingMarkdownRenderAction;
  children: VChild[];
  dom?: Element;
};
type VText = { kind: "text"; key: string; text: string; dom?: Text };
type VRaw = { kind: "raw"; key: string; dom: Node };
type VChild = VElement | VText | VRaw;

type BuildContext = {
  document: Document;
  nodeRenderers: StreamingMarkdownDomNodeRenderers | undefined;
  overrideCache: WeakMap<
    StreamingMarkdownAstNode,
    { renderer: StreamingMarkdownDomNodeRenderer; dom: Node | null }
  >;
};

function toKebabCase(property: string) {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const CARET_STYLE = Object.entries(STREAMING_MARKDOWN_CARET_STYLE)
  .map(([property, value]) => `${toKebabCase(property)}:${value}`)
  .join(";");

function caretElement(key: string): VElement {
  return {
    kind: "element",
    key,
    tag: "span",
    attrs: { ...STREAMING_MARKDOWN_CARET_ATTRS, style: CARET_STYLE },
    children: [],
  };
}

function prefixed(prefix: string, children: VChild[]) {
  return children.map((child) => ({ ...child, key: `${prefix}:${child.key}` }));
}

function toVChildren(
  children: StreamingMarkdownRenderChild[],
  context: BuildContext,
  slot: VChild[],
): VChild[] {
  return children.flatMap((child) => {
    switch (child.kind) {
      case "node":
        return toVNode(child, context);
      case "element": {
        const element: VElement = {
          kind: "element",
          key: child.key,
          tag: child.tag,
          attrs: child.attrs,
          children: toVChildren(child.children, context, slot),
        };
        return child.action
          ? [{ ...element, action: child.action }]
          : [element];
      }
      case "text":
        return [{ kind: "text", key: child.key, text: child.text }];
      case "caret":
        return [caretElement(child.key)];
      case "slot":
        return slot;
      default: {
        const unreachable: never = child;
        return unreachable;
      }
    }
  });
}

function renderOverride(
  renderNode: StreamingMarkdownRenderNode,
  renderer: StreamingMarkdownDomNodeRenderer,
  context: BuildContext,
) {
  // AST nodes keep their identity while unchanged, so an override's output can
  // be reused unless the caret (which is not part of the node) moves inside it.
  const cached = context.overrideCache.get(renderNode.node);
  if (cached?.renderer === renderer && !renderNode.containsCaret) {
    return cached.dom;
  }

  const doc = context.document;
  const materialize = (entries: VChild[]) =>
    entries.map((entry) => createDom(entry, doc));
  const children = renderNode.children
    ? materialize(toVChildren(renderNode.children, context, []))
    : null;
  const defaultNodes = materialize(
    toVChildren(
      renderNode.output,
      context,
      renderNode.children ? toVChildren(renderNode.children, context, []) : [],
    ),
  );
  const defaultNode =
    defaultNodes.length === 1
      ? defaultNodes[0]
      : wrapInFragment(defaultNodes, doc);

  const dom = renderer({
    node: renderNode.node,
    children,
    defaultNode,
    citation: renderNode.citation,
    document: doc,
  });
  context.overrideCache.set(renderNode.node, { renderer, dom });
  return dom;
}

function wrapInFragment(nodes: Node[], doc: Document) {
  if (nodes.length === 0) return null;
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  return fragment;
}

function toVNode(
  renderNode: StreamingMarkdownRenderNode,
  context: BuildContext,
): VChild[] {
  const renderer =
    context.nodeRenderers?.[renderNode.rendererKey] ??
    context.nodeRenderers?.node;
  if (renderer) {
    const dom = renderOverride(renderNode, renderer, context);
    return dom ? [{ kind: "raw", key: renderNode.key, dom }] : [];
  }

  const slot = renderNode.children
    ? toVChildren(renderNode.children, context, [])
    : [];
  return prefixed(
    renderNode.key,
    toVChildren(renderNode.output, context, slot),
  );
}

// ---------------------------------------------------------------------------
// DOM creation and keyed patching
// ---------------------------------------------------------------------------

function setAttributes(
  element: Element,
  next: Readonly<Record<string, string | true>>,
  previous: Readonly<Record<string, string | true>>,
) {
  const previousNames = Object.keys(previous);
  for (const name of previousNames) {
    if (!(name in next)) element.removeAttribute(name);
  }
  const entries = Object.entries(next);
  for (const [name, value] of entries) {
    if (previous[name] !== value) {
      element.setAttribute(name, value === true ? "" : value);
    }
  }
}

function createDom(child: VChild, doc: Document): Node {
  switch (child.kind) {
    case "raw":
      return child.dom;
    case "text": {
      child.dom = doc.createTextNode(child.text);
      return child.dom;
    }
    case "element": {
      const element = doc.createElement(child.tag);
      setAttributes(element, child.attrs, {});
      for (const entry of child.children) {
        element.appendChild(createDom(entry, doc));
      }
      child.dom = element;
      return element;
    }
    default: {
      const unreachable: never = child;
      return unreachable;
    }
  }
}

/** Updates `previous`'s DOM to match `next` and returns it, or `null` if incompatible. */
function patchDom(previous: VChild, next: VChild, doc: Document): Node | null {
  if (previous.kind === "text" && next.kind === "text" && previous.dom) {
    if (previous.text !== next.text) previous.dom.data = next.text;
    next.dom = previous.dom;
    return next.dom;
  }
  if (previous.kind === "raw" && next.kind === "raw") {
    return previous.dom === next.dom ? next.dom : null;
  }
  const sameElement =
    previous.kind === "element" &&
    next.kind === "element" &&
    previous.tag === next.tag &&
    previous.dom !== undefined;
  if (!sameElement) {
    return null;
  }
  const element = previous.dom;
  if (!element) return null;
  setAttributes(element, next.attrs, previous.attrs);
  patchChildren(element, previous.children, next.children, doc);
  next.dom = element;
  return element;
}

function patchChildren(
  parent: Node,
  previous: VChild[],
  next: VChild[],
  doc: Document,
) {
  const unused = new Map(previous.map((child) => [child.key, child]));
  let cursor: Node | null = parent.firstChild;

  for (const child of next) {
    const match = unused.get(child.key);
    const reused = match ? patchDom(match, child, doc) : null;
    if (match && reused) unused.delete(child.key);
    const dom = reused ?? createDom(child, doc);

    if (dom === cursor) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(dom, cursor);
    }
  }

  const leftovers = Array.from(unused.values());
  for (const child of leftovers) {
    const dom = child.dom;
    if (dom && dom.parentNode === parent) parent.removeChild(dom);
  }
}

// Server DOMs (domino) lack replaceChildren(), so clear by hand.
function removeAllChildren(parent: Node) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

function collectActions(
  children: VChild[],
  actions: WeakMap<Node, StreamingMarkdownRenderAction>,
) {
  for (const child of children) {
    if (child.kind !== "element" || !child.dom) continue;
    if (child.action) actions.set(child.dom, child.action);
    collectActions(child.children, actions);
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Creates a framework-free streaming markdown renderer that draws into
 * `container`. It parses incrementally, renders the same render tree as the
 * React and Vue renderers (same markup, URL sanitization, caret, citations,
 * and per-token fade-in), and patches the DOM by key so text that is already
 * on screen keeps its nodes and does not animate again.
 *
 * Creates nodes with `container.ownerDocument`, so it works with server DOMs
 * that have no global `document`.
 *
 * @param container - Element the renderer owns. Its children are replaced.
 * @returns `render(props)` to draw the latest props, and `destroy()` to remove
 * the output and the click listener.
 *
 * @example
 * ```ts
 * const renderer = createStreamingMarkdownDomRenderer(element);
 * renderer.render({ content: "**Hi**", caret: true });
 * renderer.render({ content: "**Hi** there", isComplete: true });
 * renderer.destroy();
 * ```
 * @public
 */
export function createStreamingMarkdownDomRenderer(container: HTMLElement) {
  const doc = container.ownerDocument;
  let session: StreamingMarkdownParserSession | null = null;
  let props: StreamingMarkdownDomRenderProps = { content: "" };
  let styleElement: HTMLStyleElement | null = null;
  let rootElement: HTMLDivElement | null = null;
  let previousChildren: VChild[] = [];
  let actions = new WeakMap<Node, StreamingMarkdownRenderAction>();
  const overrideCache: BuildContext["overrideCache"] = new WeakMap();

  // One delegated listener; actions are looked up per click so callbacks and
  // links always reflect the latest render.
  const onClick = (event: MouseEvent) => {
    let target = event.target instanceof Node ? event.target : null;
    while (target && target !== container) {
      const action = actions.get(target);
      if (action?.type === "link") {
        props.onLinkClick?.(event, action.url, action.node);
        return;
      }
      if (action?.type === "citation") {
        props.onCitationClick?.(event, action.citation, action.node);
        return;
      }
      target = target.parentNode;
    }
  };
  container.addEventListener("click", onClick);

  function render(nextProps: StreamingMarkdownDomRenderProps) {
    props = nextProps;
    session = updateStreamingMarkdownParserSession(
      session,
      nextProps.content,
      nextProps.options,
      nextProps.isComplete ?? false,
    );
    const state = session.parserState;
    const tree = buildStreamingMarkdownRenderTree(state, {
      caret: nextProps.caret === true,
      nodeClassNames: nextProps.nodeClassNames,
    });

    if (!styleElement || !rootElement || rootElement.parentNode !== container) {
      styleElement = doc.createElement("style");
      rootElement = doc.createElement("div");
      rootElement.setAttribute("data-streaming-markdown-root", "");
      previousChildren = [];
      removeAllChildren(container);
      container.appendChild(styleElement);
      container.appendChild(rootElement);
    }
    const styles = getStreamingMarkdownStyles();
    if (styleElement.textContent !== styles) styleElement.textContent = styles;
    const rootClass = nextProps.className
      ? `${STREAMING_MARKDOWN_ROOT_CLASS} ${nextProps.className}`
      : STREAMING_MARKDOWN_ROOT_CLASS;
    if (rootElement.className !== rootClass) rootElement.className = rootClass;

    const nextChildren = tree.root
      ? toVNode(tree.root, {
          document: doc,
          nodeRenderers: nextProps.nodeRenderers,
          overrideCache,
        })
      : [];
    patchChildren(rootElement, previousChildren, nextChildren, doc);
    previousChildren = nextChildren;
    actions = new WeakMap();
    collectActions(nextChildren, actions);
  }

  function destroy() {
    container.removeEventListener("click", onClick);
    removeAllChildren(container);
    session = null;
    styleElement = null;
    rootElement = null;
    previousChildren = [];
  }

  return { render, destroy };
}

/**
 * Renderer returned by {@link createStreamingMarkdownDomRenderer}.
 * @public
 */
export type StreamingMarkdownDomRenderer = ReturnType<
  typeof createStreamingMarkdownDomRenderer
>;
