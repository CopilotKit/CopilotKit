import type { DraftNode } from "./internal";
import type {
  CitationState,
  StreamingMarkdownAstNode,
  StreamingMarkdownHeadingNode,
  StreamingMarkdownWarning,
  TextSegment,
} from "./types";

/**
 * Operation protocol used to reduce tokenized draft trees into immutable AST state.
 * @internal
 */
export type StreamingMarkdownAstOp =
  | {
      kind: "upsert-node";
      path: string;
      parentPath: string | null;
      type: DraftNode["type"];
      range: { start: number; end: number };
      closed: boolean;
      props: Record<string, unknown>;
      childPaths: string[];
    }
  | { kind: "set-warnings"; warnings: StreamingMarkdownWarning[] }
  | { kind: "set-citations"; citations: CitationState }
  | {
      kind: "set-segmenter-warning-state";
      hasWarnedSegmenterUnavailable: boolean;
    };

/**
 * Flattens a draft tree into reducer operations.
 *
 * @param root - Draft AST root.
 * @returns Ordered operations for reducer application.
 */
export function createAstOpsFromDraft(
  root: DraftNode,
): StreamingMarkdownAstOp[] {
  const ops: StreamingMarkdownAstOp[] = [];

  function visit(node: DraftNode, parentPath: string | null) {
    const childPaths = node.children.map(
      (child, index) => `${node.path}.${index}`,
    );

    ops.push({
      kind: "upsert-node",
      path: node.path,
      parentPath,
      type: node.type,
      range: node.range,
      closed: node.closed,
      props: node.props,
      childPaths,
    });

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      visit({ ...child, path: `${node.path}.${index}` }, node.path);
    }
  }

  visit(root, null);
  return ops;
}

/**
 * Applies AST ops with identity reuse for unchanged nodes.
 *
 * @param input - Previous parser state fragments and ops to apply.
 * @returns Next materialized state fragments.
 */
export function applyAstOps(input: {
  previousNodes: StreamingMarkdownAstNode[];
  previousPathToId: Record<string, number>;
  nextId: number;
  ops: StreamingMarkdownAstOp[];
}): {
  nodes: StreamingMarkdownAstNode[];
  rootId: number;
  nextId: number;
  pathToId: Record<string, number>;
  warnings: StreamingMarkdownWarning[];
  citations: CitationState;
  hasWarnedSegmenterUnavailable: boolean;
} {
  const previousNodeById = new Map(
    input.previousNodes.map((node) => [node.id, node]),
  );
  const nodeOps = input.ops.filter(
    (op): op is Extract<StreamingMarkdownAstOp, { kind: "upsert-node" }> =>
      op.kind === "upsert-node",
  );

  const pathToId: Record<string, number> = {};
  let nextId = input.nextId;

  for (const op of nodeOps) {
    const existingId = input.previousPathToId[op.path];
    const id = existingId ?? nextId++;
    pathToId[op.path] = id;
  }

  const nodesById = new Map<number, StreamingMarkdownAstNode>();

  for (const op of nodeOps) {
    const id = pathToId[op.path];
    const parentId = op.parentPath ? pathToId[op.parentPath] : null;
    const childIds = op.childPaths.map((childPath) => pathToId[childPath]);
    const materialized = opToAstNode(op, id, parentId, childIds);
    const previous = previousNodeById.get(id);
    const reconciled =
      previous?.type === "text" && materialized.type === "text"
        ? reconcileTextNode(previous, materialized)
        : materialized;

    nodesById.set(
      id,
      previous && astNodeEquals(previous, reconciled) ? previous : reconciled,
    );
  }

  const rootPath = nodeOps[0]?.path;
  if (!rootPath) {
    throw new Error("StreamingMarkdown op stream did not include a root node");
  }

  const warnings =
    input.ops.find(
      (op): op is Extract<StreamingMarkdownAstOp, { kind: "set-warnings" }> =>
        op.kind === "set-warnings",
    )?.warnings ?? [];
  const citations = input.ops.find(
    (op): op is Extract<StreamingMarkdownAstOp, { kind: "set-citations" }> =>
      op.kind === "set-citations",
  )?.citations ?? { order: [], numbers: {}, definitions: {} };
  const hasWarnedSegmenterUnavailable =
    input.ops.find(
      (
        op,
      ): op is Extract<
        StreamingMarkdownAstOp,
        { kind: "set-segmenter-warning-state" }
      > => op.kind === "set-segmenter-warning-state",
    )?.hasWarnedSegmenterUnavailable ?? false;

  return {
    nodes: Array.from(nodesById.values()).sort((a, b) => a.id - b.id),
    rootId: pathToId[rootPath],
    nextId,
    pathToId,
    warnings,
    citations,
    hasWarnedSegmenterUnavailable,
  };
}

function opToAstNode(
  op: Extract<StreamingMarkdownAstOp, { kind: "upsert-node" }>,
  id: number,
  parentId: number | null,
  children: number[],
): StreamingMarkdownAstNode {
  const base = {
    id,
    type: op.type,
    parentId,
    closed: op.closed,
    range: op.range,
  };

  switch (op.type) {
    case "document":
      return { ...base, type: "document", children };
    case "paragraph":
      return { ...base, type: "paragraph", children };
    case "heading":
      return {
        ...base,
        type: "heading",
        level: op.props["level"] as StreamingMarkdownHeadingNode["level"],
        children,
      };
    case "blockquote":
      return { ...base, type: "blockquote", children };
    case "list":
      return {
        ...base,
        type: "list",
        ordered: op.props["ordered"] as boolean,
        start: op.props["start"] as number | null,
        tight: op.props["tight"] as boolean,
        children,
      };
    case "list-item":
      return { ...base, type: "list-item", children };
    case "code-block":
      return {
        ...base,
        type: "code-block",
        fence: op.props["fence"] as "```" | "~~~",
        info: op.props["info"] as string | undefined,
        meta: op.props["meta"] as string | undefined,
        text: op.props["text"] as string,
      };
    case "table":
      return {
        ...base,
        type: "table",
        align: op.props["align"] as Array<"left" | "right" | "center" | "none">,
        children,
      };
    case "table-row":
      return {
        ...base,
        type: "table-row",
        isHeader: op.props["isHeader"] as boolean,
        children,
      };
    case "table-cell":
      return { ...base, type: "table-cell", children };
    case "thematic-break":
      return { ...base, type: "thematic-break" };
    case "text":
      return {
        ...base,
        type: "text",
        text: op.props["text"] as string,
        segments: op.props["segments"] as TextSegment[],
      };
    case "em":
      return { ...base, type: "em", children };
    case "strong":
      return { ...base, type: "strong", children };
    case "strikethrough":
      return { ...base, type: "strikethrough", children };
    case "inline-code":
      return {
        ...base,
        type: "inline-code",
        text: op.props["text"] as string,
      };
    case "soft-break":
      return { ...base, type: "soft-break" };
    case "hard-break":
      return { ...base, type: "hard-break" };
    case "link":
      return {
        ...base,
        type: "link",
        url: op.props["url"] as string,
        title: op.props["title"] as string | undefined,
        children,
      };
    case "image":
      return {
        ...base,
        type: "image",
        url: op.props["url"] as string,
        title: op.props["title"] as string | undefined,
        alt: op.props["alt"] as string,
      };
    case "autolink":
      return {
        ...base,
        type: "autolink",
        url: op.props["url"] as string,
        text: op.props["text"] as string,
      };
    default:
      return {
        ...base,
        type: "citation",
        idRef: op.props["idRef"] as string,
        number: op.props["number"] as number | undefined,
      };
  }
}

function astNodeEquals(
  a: StreamingMarkdownAstNode,
  b: StreamingMarkdownAstNode,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function reconcileTextNode(
  previous: Extract<StreamingMarkdownAstNode, { type: "text" }>,
  next: Extract<StreamingMarkdownAstNode, { type: "text" }>,
): Extract<StreamingMarkdownAstNode, { type: "text" }> {
  if (next.segments.length === 0 || previous.segments.length === 0) {
    return next;
  }

  const previousBySignature = groupSegmentsBySignature(previous.segments);
  let reusedAnySegment = false;

  const segments = next.segments.map((segment) => {
    const signature = getSegmentSignature(segment);
    const bucket = previousBySignature.get(signature);
    if (!bucket?.length) {
      return segment;
    }

    const [reused, ...rest] = bucket;
    if (rest.length) {
      previousBySignature.set(signature, rest);
    } else {
      previousBySignature.delete(signature);
    }

    reusedAnySegment = true;
    return reused;
  });

  if (areSegmentArraysIdentical(previous.segments, segments)) {
    return {
      ...next,
      segments: previous.segments,
    };
  }

  if (!reusedAnySegment) {
    return next;
  }

  return {
    ...next,
    segments,
  };
}

/**
 * Returns true when both arrays contain the same segment object references in order.
 */
function areSegmentArraysIdentical(
  a: TextSegment[],
  b: TextSegment[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((segment, index) => segment === b[index]);
}

/**
 * Produces a stable signature for matching segments across immutable parse iterations.
 */
function getSegmentSignature(segment: TextSegment): string {
  return `${segment.start}:${segment.end}:${segment.text}:${segment.kind}:${String(segment.isWhitespace)}:${String(segment.noBreakBefore === true)}`;
}

/**
 * Groups previous segments by signature to support one-to-one identity reuse.
 */
function groupSegmentsBySignature(
  segments: TextSegment[],
): Map<string, TextSegment[]> {
  const bySignature = new Map<string, TextSegment[]>();

  for (const segment of segments) {
    const signature = getSegmentSignature(segment);
    const existing = bySignature.get(signature) ?? [];
    bySignature.set(signature, [...existing, segment]);
  }

  return bySignature;
}
