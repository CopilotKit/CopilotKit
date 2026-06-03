import React, { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "@copilotkit/markdown-renderer";
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownParserState,
} from "@copilotkit/markdown-renderer";

// ---------------------------------------------------------------------------
// Style types
// ---------------------------------------------------------------------------

/**
 * Style-object for the RN streaming markdown renderer.
 * Every key is optional — defaults cover all built-in node types.
 *
 * @public
 */
export type MarkdownStyle = {
  paragraph?: Record<string, unknown>;
  h1?: Record<string, unknown>;
  h2?: Record<string, unknown>;
  h3?: Record<string, unknown>;
  h4?: Record<string, unknown>;
  h5?: Record<string, unknown>;
  h6?: Record<string, unknown>;
  strong?: Record<string, unknown>;
  em?: Record<string, unknown>;
  strikethrough?: Record<string, unknown>;
  inlineCode?: Record<string, unknown>;
  codeBlock?: Record<string, unknown>;
  codeBlockText?: Record<string, unknown>;
  blockquote?: Record<string, unknown>;
  list?: Record<string, unknown>;
  listItem?: Record<string, unknown>;
  listBullet?: Record<string, unknown>;
  link?: Record<string, unknown>;
  image?: Record<string, unknown>;
  tableRow?: Record<string, unknown>;
  tableCell?: Record<string, unknown>;
};

/**
 * Default styles for all built-in node types.
 *
 * @public
 */
export const defaultMarkdownStyles: MarkdownStyle = {
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: "#1a1a1a",
    marginTop: 4,
    marginBottom: 4,
  },
  h1: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 8,
    color: "#111111",
  },
  h2: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 6,
    color: "#111111",
  },
  h3: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
    color: "#222222",
  },
  h4: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 4,
    color: "#222222",
  },
  h5: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 2,
    color: "#333333",
  },
  h6: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 2,
    color: "#444444",
  },
  strong: { fontWeight: "bold" },
  em: { fontStyle: "italic" },
  strikethrough: { textDecorationLine: "line-through" },
  inlineCode: {
    backgroundColor: "#f0f0f0",
    fontFamily: "monospace",
    fontSize: 14,
  },
  codeBlock: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  },
  codeBlockText: {
    fontFamily: "monospace",
    fontSize: 14,
    color: "#1a1a1a",
  },
  blockquote: {
    backgroundColor: "#f5f5f5",
    borderLeftWidth: 4,
    borderLeftColor: "#cccccc",
    paddingLeft: 12,
    marginVertical: 4,
  },
  list: { marginTop: 4, marginBottom: 4 },
  listItem: { flexDirection: "row", alignItems: "flex-start" } as any,
  listBullet: { marginRight: 6, fontSize: 16, lineHeight: 24 },
  link: { color: "#0066cc", textDecorationLine: "underline" },
  image: {},
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e0e0e0" } as any,
  tableCell: { flex: 1, padding: 4 },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for the React Native `StreamingMarkdownRenderer`.
 *
 * @public
 */
export interface StreamingMarkdownRendererProps {
  /** Full markdown source (may grow over time during streaming). */
  content: string;
  /** When true, finalizes the parser state after processing content. */
  isComplete?: boolean;
  /** Style overrides merged with `defaultMarkdownStyles`. */
  style?: MarkdownStyle;
  /**
   * When true, enables `Intl.Segmenter`-based per-token animation.
   * Defaults to `false` — safe on Hermes which may not ship Segmenter.
   */
  animate?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RenderContext = {
  nodeById: Map<number, StreamingMarkdownAstNode>;
  s: MarkdownStyle;
};

function renderChildren(
  node: Extract<StreamingMarkdownAstNode, { children: number[] }>,
  ctx: RenderContext,
): ReactNode {
  return node.children.map((id) => {
    const child = ctx.nodeById.get(id);
    if (!child) return null;
    return <Fragment key={id}>{renderNode(child, ctx)}</Fragment>;
  });
}

function renderTextContent(
  node: Extract<StreamingMarkdownAstNode, { children: number[] }>,
  ctx: RenderContext,
): ReactNode {
  return node.children.map((id) => {
    const child = ctx.nodeById.get(id);
    if (!child) return null;
    return <Fragment key={id}>{renderInlineNode(child, ctx)}</Fragment>;
  });
}

/**
 * Render an inline node (text, strong, em, etc.) as a React Native `<Text>`.
 * Returns `null` for block-level nodes that can't be nested in `<Text>`.
 */
function renderInlineNode(
  node: StreamingMarkdownAstNode,
  ctx: RenderContext,
): ReactNode {
  switch (node.type) {
    case "text":
      return node.text;

    case "strong":
      return (
        <Text key={node.id} style={ctx.s.strong as any}>
          {renderTextContent(node, ctx)}
        </Text>
      );

    case "em":
      return (
        <Text key={node.id} style={ctx.s.em as any}>
          {renderTextContent(node, ctx)}
        </Text>
      );

    case "strikethrough":
      return (
        <Text key={node.id} style={ctx.s.strikethrough as any}>
          {renderTextContent(node, ctx)}
        </Text>
      );

    case "inline-code":
      return (
        <Text key={node.id} style={ctx.s.inlineCode as any}>
          {node.text}
        </Text>
      );

    case "link":
    case "autolink":
      // Non-navigable: render as styled Text only — zero URL/XSS surface.
      return (
        <Text key={node.id} style={ctx.s.link as any}>
          {"children" in node ? renderTextContent(node as any, ctx) : (node as any).text}
        </Text>
      );

    case "image":
      // Images can't be embedded in <Text>; render alt text.
      return (
        <Text key={node.id} style={ctx.s.image as any}>
          {(node as any).alt}
        </Text>
      );

    case "soft-break":
      return "\n";

    case "hard-break":
      return "\n";

    case "citation":
      // Citation marker (e.g. "[1]"). This is an inline-level node reached via
      // a paragraph/heading's renderTextContent; without this case it would
      // fall through to `default` and render nothing (no text/children).
      // Prefer the resolved number, fall back to the citation id.
      return (
        <Text key={node.id} style={{ fontSize: 12, verticalAlign: "top" } as any}>
          [{(node as any).number ?? (node as any).idRef}]
        </Text>
      );

    default:
      // Fallback for any inline nodes not explicitly handled
      if ("text" in node && typeof (node as any).text === "string") {
        return (node as any).text;
      }
      if ("children" in node) {
        return renderTextContent(node as any, ctx);
      }
      return null;
  }
}

function renderNode(
  node: StreamingMarkdownAstNode,
  ctx: RenderContext,
): ReactNode {
  switch (node.type) {
    case "document":
      return <Fragment key={node.id}>{renderChildren(node, ctx)}</Fragment>;

    case "paragraph":
      return (
        <Text key={node.id} style={ctx.s.paragraph as any}>
          {renderTextContent(node, ctx)}
        </Text>
      );

    case "heading": {
      const level = node.level as 1 | 2 | 3 | 4 | 5 | 6;
      const headingStyle = ctx.s[`h${level}` as keyof MarkdownStyle] ?? ctx.s.h6;
      return (
        <Text key={node.id} style={headingStyle as any}>
          {renderTextContent(node, ctx)}
        </Text>
      );
    }

    case "blockquote":
      return (
        <View key={node.id} style={ctx.s.blockquote as any}>
          {renderChildren(node, ctx)}
        </View>
      );

    case "list":
      return (
        <View key={node.id} style={ctx.s.list as any}>
          {node.children.map((itemId, index) => {
            const item = ctx.nodeById.get(itemId);
            if (!item) return null;
            const bullet = node.ordered ? `${(node.start ?? 1) + index}. ` : "• ";
            return (
              <View key={itemId} style={ctx.s.listItem as any}>
                <Text style={ctx.s.listBullet as any}>{bullet}</Text>
                <View style={{ flex: 1 }}>
                  {renderChildren(
                    item as Extract<StreamingMarkdownAstNode, { children: number[] }>,
                    ctx,
                  )}
                </View>
              </View>
            );
          })}
        </View>
      );

    case "list-item":
      // Handled inside "list" above; fallback in case a list-item appears standalone
      return (
        <View key={node.id} style={ctx.s.listItem as any}>
          {renderChildren(node, ctx)}
        </View>
      );

    case "code-block":
      return (
        <View key={node.id} style={ctx.s.codeBlock as any}>
          <Text style={ctx.s.codeBlockText as any}>{node.text}</Text>
        </View>
      );

    case "table":
      return (
        <View key={node.id}>
          {renderChildren(node, ctx)}
        </View>
      );

    case "table-row":
      return (
        <View key={node.id} style={ctx.s.tableRow as any}>
          {renderChildren(node, ctx)}
        </View>
      );

    case "table-cell":
      return (
        <View key={node.id} style={ctx.s.tableCell as any}>
          <Text>{renderTextContent(node, ctx)}</Text>
        </View>
      );

    case "thematic-break":
      return (
        <View
          key={node.id}
          style={{
            borderBottomWidth: 1,
            borderBottomColor: "#e0e0e0",
            marginVertical: 8,
          }}
        />
      );

    case "text":
      return <Text key={node.id}>{node.text}</Text>;

    case "strong":
    case "em":
    case "strikethrough":
    case "inline-code":
    case "link":
    case "autolink":
    case "image":
    case "soft-break":
    case "hard-break":
    case "citation":
      // These are inline; wrap in Text for block-level context. Citation
      // rendering lives in renderInlineNode so block and inline paths agree.
      return <Text key={node.id}>{renderInlineNode(node, ctx)}</Text>;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function buildParserState(
  content: string,
  isComplete: boolean,
  animate: boolean,
): StreamingMarkdownParserState {
  const state = createStreamingMarkdownParserState({
    segmenter: animate,
    enableTables: true,
    enableAutolinks: true,
  });
  const parsed = parseStreamingMarkdownChunk(state, content);
  return isComplete ? finalizeStreamingMarkdown(parsed) : parsed;
}

/**
 * React Native streaming markdown renderer powered by the zero-dependency
 * `@copilotkit/markdown-renderer` parser.
 *
 * Defaults `segmenter: false` — safe on Hermes which may not ship `Intl.Segmenter`.
 * Pass `animate={true}` only when you have confirmed Segmenter availability.
 *
 * @public
 */
export function StreamingMarkdownRenderer({
  content,
  isComplete = false,
  style,
  animate = false,
}: StreamingMarkdownRendererProps): React.ReactElement | null {
  const mergedStyles = useMemo<MarkdownStyle>(
    () => (style ? { ...defaultMarkdownStyles, ...style } : defaultMarkdownStyles),
    [style],
  );

  const parserState = useMemo(
    () => buildParserState(content ?? "", isComplete, animate),
    [content, isComplete, animate],
  );

  const nodeById = useMemo(() => {
    const map = new Map<number, StreamingMarkdownAstNode>();
    for (const node of parserState.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [parserState.nodes]);

  const ctx: RenderContext = useMemo(
    () => ({ nodeById, s: mergedStyles }),
    [nodeById, mergedStyles],
  );

  if (parserState.rootId == null) {
    return null;
  }

  const rootNode = nodeById.get(parserState.rootId);
  if (!rootNode) {
    return null;
  }

  return <>{renderNode(rootNode, ctx)}</>;
}
