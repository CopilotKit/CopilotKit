/*
 * Derived from Hashbrown's pure functional streaming JSON parser.
 * Copyright (c) 2025 LiveLoveApp, LLC. MIT licensed; see THIRD_PARTY_NOTICES.md.
 */

/**
 * JSON-compatible value shape returned by the parser once complete.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * JSON value that may be partially resolved while parsing.
 */
export type JsonResolvedValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonResolvedValue[]
  | { readonly [key: string]: JsonResolvedValue }
  | undefined;

/**
 * AST node kinds produced by the streaming parser.
 */
export type JsonAstType =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object";

/**
 * Shared fields for all AST node shapes.
 */
export type JsonAstBase = {
  readonly id: number;
  readonly type: JsonAstType;
  readonly parentId: number | null;
  readonly closed: boolean;
  readonly resolvedValue: JsonResolvedValue;
};

/**
 * AST node representing a `null` literal.
 */
export type JsonNullAstNode = JsonAstBase & {
  readonly type: "null";
  readonly resolvedValue: null | undefined;
};

/**
 * AST node representing a boolean literal.
 */
export type JsonBooleanAstNode = JsonAstBase & {
  readonly type: "boolean";
  readonly resolvedValue: boolean | undefined;
};

/**
 * AST node representing a number literal, including its raw buffer.
 */
export type JsonNumberAstNode = JsonAstBase & {
  readonly type: "number";
  readonly buffer: string;
  readonly resolvedValue: number | undefined;
};

/**
 * AST node representing a string literal, including its raw buffer.
 */
export type JsonStringAstNode = JsonAstBase & {
  readonly type: "string";
  readonly buffer: string;
  readonly resolvedValue: string | undefined;
};

/**
 * AST node representing an array container.
 */
export type JsonArrayAstNode = JsonAstBase & {
  readonly type: "array";
  readonly children: readonly number[];
  readonly resolvedValue: readonly JsonResolvedValue[] | undefined;
};

/**
 * AST node representing an object container.
 */
export type JsonObjectAstNode = JsonAstBase & {
  readonly type: "object";
  readonly keys: readonly string[];
  readonly children: readonly number[];
  readonly resolvedValue:
    | Readonly<Record<string, JsonResolvedValue>>
    | undefined;
};

/**
 * Union of all AST node shapes.
 */
export type JsonAstNode =
  | JsonNullAstNode
  | JsonBooleanAstNode
  | JsonNumberAstNode
  | JsonStringAstNode
  | JsonArrayAstNode
  | JsonObjectAstNode;

/**
 * Error information captured by the parser when invalid JSON is encountered.
 */
export type StreamingErrorCode =
  | "syntax_error"
  | "unexpected_end"
  | "max_bytes"
  | "max_depth"
  | "max_nodes";

export type ParserError = {
  readonly code: StreamingErrorCode;
  readonly message: string;
  readonly index: number;
  readonly line: number;
  readonly column: number;
  readonly limit?: number;
  readonly observed?: number;
};

export type ParserLimits = {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
};

/**
 * Internal parser mode that drives state transitions.
 */
export type ParseMode =
  | "Value"
  | "ArrayValue"
  | "ArrayValueOrEnd"
  | "ObjectKey"
  | "ObjectKeyOrEnd"
  | "ObjectColon"
  | "CommaOrEnd"
  | "String"
  | "Number"
  | "Literal"
  | "Done"
  | "Error";

/**
 * Complete immutable parser state for streaming JSON parsing.
 */
export type ParserState = {
  readonly nextId: number;
  readonly mode: ParseMode;
  readonly stack: readonly number[];
  readonly nodes: readonly JsonAstNode[];
  readonly rootId: number | null;
  readonly error: ParserError | null;
  readonly isComplete: boolean;
  readonly index: number;
  readonly line: number;
  readonly column: number;
  readonly stringContext: "value" | "key" | null;
  readonly stringEscape: boolean;
  readonly stringUnicode: string | null;
  readonly literalExpected: string | null;
  readonly literalBuffer: string;
  readonly pendingKey: string | null;
  readonly pendingKeyOwner: number | null;
  readonly currentNodeId: number | null;
  readonly keyBuffer: string;
  readonly rawText: string;
  readonly limits: ParserLimits;
};

export type ParserOperation = {
  readonly state: ParserState;
  readonly error?: ParserError;
};

const numberPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const stringEscapeMap: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Returns true when the character is JSON whitespace.
 *
 * @param ch - Character to test.
 * @returns True when the character is whitespace in JSON.
 */
function isWhitespace(ch: string) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Returns true for characters that may appear in a JSON number literal.
 *
 * @param ch - Character to test.
 * @returns True when the character is allowed in a JSON number literal.
 */
function isNumberChar(ch: string) {
  return (
    (ch >= "0" && ch <= "9") ||
    ch === "-" ||
    ch === "+" ||
    ch === "." ||
    ch === "e" ||
    ch === "E"
  );
}

/**
 * Returns true for hexadecimal digits used in unicode escapes.
 *
 * @param ch - Character to test.
 * @returns True when the character is a hexadecimal digit.
 */
function isHexDigit(ch: string) {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

/**
 * Returns a new nodes array with a single node replaced, preserving identity when unchanged.
 *
 * @param nodes - Current nodes array.
 * @param id - Node id to replace.
 * @param node - Replacement node.
 * @returns Updated nodes array or the original when unchanged.
 */
function replaceNode(
  nodes: readonly JsonAstNode[],
  id: number,
  node: JsonAstNode,
) {
  if (nodes[id] === node) {
    return nodes;
  }

  const nextNodes = nodes.slice();
  nextNodes[id] = node;
  return nextNodes;
}

/**
 * Returns the previous array value if it is structurally identical to the new values.
 *
 * @param arr - Previous resolved array.
 * @param values - Newly computed values.
 * @returns Previous array when identical, otherwise the new values.
 */
function appendArrayValue(
  arr: readonly JsonResolvedValue[],
  values: readonly JsonResolvedValue[],
) {
  if (arr.length !== values.length) {
    return values;
  }

  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] !== values[i]) {
      return values;
    }
  }

  return arr;
}

/**
 * Returns the previous object value if it is structurally identical to the new values.
 *
 * @param obj - Previous resolved object.
 * @param keys - Keys to compare.
 * @param values - Newly computed values.
 * @returns Previous object when identical, otherwise the new values.
 */
function appendObjectValue(
  obj: Readonly<Record<string, JsonResolvedValue>>,
  keys: readonly string[],
  values: Readonly<Record<string, JsonResolvedValue>>,
) {
  if (Object.keys(obj).length !== keys.length) {
    return values;
  }

  for (const key of keys) {
    if (obj[key] !== values[key]) {
      return values;
    }
  }

  return obj;
}

/**
 * Recomputes resolved values for array/object nodes while preserving identity when unchanged.
 *
 * @param node - Container node to recompute.
 * @param nodes - Full AST node list.
 * @returns Updated node when resolved values change, otherwise the original node.
 */
function recomputeContainerResolved(
  node: JsonAstNode,
  nodes: readonly JsonAstNode[],
) {
  if (node.type === "array") {
    const values = node.children.map((childId) => nodes[childId].resolvedValue);
    const resolved = node.resolvedValue
      ? appendArrayValue(node.resolvedValue, values)
      : values;
    if (resolved === node.resolvedValue) {
      return node;
    }

    return { ...node, resolvedValue: resolved } as JsonArrayAstNode;
  }

  if (node.type === "object") {
    const values: Record<string, JsonResolvedValue> = {};
    for (let i = 0; i < node.keys.length; i += 1) {
      const key = node.keys[i];
      Object.defineProperty(values, key, {
        configurable: true,
        enumerable: true,
        value: nodes[node.children[i]].resolvedValue,
        writable: true,
      });
    }

    const resolved = node.resolvedValue
      ? appendObjectValue(node.resolvedValue, node.keys, values)
      : values;

    if (resolved === node.resolvedValue) {
      return node;
    }

    return { ...node, resolvedValue: resolved } as JsonObjectAstNode;
  }

  return node;
}

/**
 * Propagates resolved value updates up the ancestor chain.
 *
 * @param nodes - Current nodes array.
 * @param startParentId - Parent id to begin propagating from.
 * @returns Updated nodes array with resolved values refreshed.
 */
function propagateResolved(
  nodes: readonly JsonAstNode[],
  startParentId: number | null,
) {
  let nextNodes = nodes;
  let currentId = startParentId;

  while (currentId !== null) {
    const current = nextNodes[currentId];
    const updated = recomputeContainerResolved(current, nextNodes);
    if (updated !== current) {
      nextNodes = replaceNode(nextNodes, currentId, updated);
    }
    currentId = updated.parentId;
  }

  return nextNodes;
}

/**
 * Creates a parser error object at the provided position.
 *
 * @param message - Error message.
 * @param index - Absolute character index.
 * @param line - Line number (1-based).
 * @param column - Column number (1-based).
 * @returns Parser error metadata.
 */
function createError(
  message: string,
  index: number,
  line: number,
  column: number,
): ParserError {
  return {
    code:
      message === "Unexpected end of JSON input"
        ? "unexpected_end"
        : "syntax_error",
    message,
    index,
    line,
    column,
  };
}

/**
 * Returns the next mode after a value is completed.
 *
 * @param stack - Current container stack.
 * @returns Next parser mode and completion flag.
 */
function afterValue(stack: readonly number[]) {
  if (stack.length === 0) {
    return { mode: "Done" as const, isComplete: true };
  }

  return { mode: "CommaOrEnd" as const, isComplete: false };
}

/**
 * Creates the initial parser state for a new JSON stream.
 *
 * @returns Fresh parser state.
 */
function createHashbrownParserState(): ParserState {
  return {
    nextId: 0,
    mode: "Value",
    stack: [],
    nodes: [],
    rootId: null,
    error: null,
    isComplete: false,
    index: 0,
    line: 1,
    column: 1,
    stringContext: null,
    stringEscape: false,
    stringUnicode: null,
    literalExpected: null,
    literalBuffer: "",
    pendingKey: null,
    pendingKeyOwner: null,
    currentNodeId: null,
    keyBuffer: "",
    rawText: "",
    limits: { maxBytes: 65_536, maxDepth: 32, maxNodes: 10_000 },
  };
}

/**
 * Opens a new AST node and attaches it to the current container when applicable.
 *
 * @param state - Current parser state.
 * @param type - Node type to open.
 * @returns Updated state and new node id.
 */
function openNode(
  state: ParserState,
  type: JsonAstType,
): {
  state: ParserState;
  nodeId: number;
} {
  const id = state.nextId;
  const parentId = state.stack.length
    ? state.stack[state.stack.length - 1]
    : null;
  if (state.rootId !== null && parentId === null) {
    return {
      state: {
        ...state,
        error: createError(
          "Unexpected token after root value",
          state.index,
          state.line,
          state.column,
        ),
        mode: "Error",
        isComplete: false,
      },
      nodeId: -1,
    };
  }

  let node: JsonAstNode;
  switch (type) {
    case "string":
      node = {
        id,
        type,
        parentId,
        closed: false,
        resolvedValue: undefined,
        buffer: "",
      };
      break;
    case "number":
      node = {
        id,
        type,
        parentId,
        closed: false,
        resolvedValue: undefined,
        buffer: "",
      };
      break;
    case "array":
      node = {
        id,
        type,
        parentId,
        closed: false,
        resolvedValue: [],
        children: [],
      };
      break;
    case "object":
      node = {
        id,
        type,
        parentId,
        closed: false,
        resolvedValue: {},
        children: [],
        keys: [],
      };
      break;
    case "boolean":
      node = { id, type, parentId, closed: false, resolvedValue: undefined };
      break;
    case "null":
      node = { id, type, parentId, closed: false, resolvedValue: undefined };
      break;
  }

  const nodesWithNewNode = state.nodes.slice();
  nodesWithNewNode[id] = node;
  let nodes: readonly JsonAstNode[] = nodesWithNewNode;

  let stack = state.stack;
  let pendingKey = state.pendingKey;
  let pendingKeyOwner = state.pendingKeyOwner;

  if (parentId !== null) {
    const parent = nodes[parentId];
    if (parent.type === "array") {
      const children = parent.children.concat(id);
      const updatedParent: JsonArrayAstNode = {
        ...parent,
        children,
      };
      nodes = replaceNode(nodes, parentId, updatedParent);
      nodes = propagateResolved(nodes, parentId);
    } else if (parent.type === "object") {
      if (!pendingKey || pendingKeyOwner !== parentId) {
        return {
          state: {
            ...state,
            error: createError(
              "Missing object key before value",
              state.index,
              state.line,
              state.column,
            ),
            mode: "Error",
            isComplete: false,
          },
          nodeId: -1,
        };
      }

      const keys = parent.keys.concat(pendingKey);
      const children = parent.children.concat(id);
      const updatedParent: JsonObjectAstNode = {
        ...parent,
        keys,
        children,
      };
      nodes = replaceNode(nodes, parentId, updatedParent);
      nodes = propagateResolved(nodes, parentId);
      pendingKey = null;
      pendingKeyOwner = null;
    }
  }

  if (type === "array" || type === "object") {
    stack = stack.concat(id);
  }

  return {
    state: {
      ...state,
      nodes,
      stack,
      rootId: state.rootId === null ? id : state.rootId,
      nextId: state.nextId + 1,
      pendingKey,
      pendingKeyOwner,
    },
    nodeId: id,
  };
}

/**
 * Closes a primitive node and updates resolved values up the tree.
 *
 * @param state - Current parser state.
 * @param nodeId - Node id to close.
 * @param value - Final resolved value.
 * @returns Updated parser state.
 */
function closePrimitiveNode(
  state: ParserState,
  nodeId: number,
  value: JsonValue,
) {
  const node = state.nodes[nodeId];
  const updated = {
    ...node,
    closed: true,
    resolvedValue: value,
  } as JsonAstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}

/**
 * Closes an array or object node and updates resolved values up the tree.
 *
 * @param state - Current parser state.
 * @param nodeId - Container node id to close.
 * @returns Updated parser state.
 */
function closeContainerNode(state: ParserState, nodeId: number): ParserState {
  const node = state.nodes[nodeId];
  const updated = { ...node, closed: true } as JsonAstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}

/**
 * Adds a string fragment to the current string buffer or key buffer.
 *
 * @param state - Current parser state.
 * @param fragment - String fragment to append.
 * @returns Updated parser state.
 */
function appendStringFragment(
  state: ParserState,
  fragment: string,
): ParserState {
  if (state.stringContext === "value") {
    if (state.currentNodeId === null) {
      return state;
    }

    const node = state.nodes[state.currentNodeId] as JsonStringAstNode;
    const nextBuffer = node.buffer + fragment;
    const updated = {
      ...node,
      buffer: nextBuffer,
      // Keep partial string value available while still open.
      resolvedValue: nextBuffer,
    };
    let nodes = replaceNode(state.nodes, state.currentNodeId, updated);
    nodes = propagateResolved(nodes, updated.parentId);
    return { ...state, nodes };
  }

  return { ...state, keyBuffer: state.keyBuffer + fragment };
}

/**
 * Starts parsing an object key string.
 *
 * @param state - Current parser state.
 * @returns Updated parser state ready to capture an object key.
 */
function startObjectKeyString(state: ParserState): ParserState {
  return {
    ...state,
    mode: "String",
    stringContext: "key",
    stringEscape: false,
    stringUnicode: null,
    keyBuffer: "",
  };
}

/**
 * Closes a container and updates the parser mode based on the new stack.
 *
 * @param state - Current parser state.
 * @param nodeId - Container node id to close.
 * @returns Updated parser state with adjusted mode.
 */
function closeContainerAndAdvance(
  state: ParserState,
  nodeId: number,
): ParserState {
  const next = closeContainerNode(state, nodeId);
  const stack = next.stack.slice(0, -1);
  const result = afterValue(stack);
  return {
    ...next,
    stack,
    mode: result.mode,
    isComplete: result.isComplete,
  };
}

/**
 * Validates and finalizes the current number buffer.
 *
 * @param state - Current parser state.
 * @param nodeId - Number node id to finalize.
 * @returns Updated parser state.
 */
function finalizeNumber(state: ParserState, nodeId: number): ParserState {
  const node = state.nodes[nodeId];
  if (node.type !== "number") {
    return state;
  }

  if (!numberPattern.test(node.buffer)) {
    return {
      ...state,
      error: createError(
        "Invalid number",
        state.index,
        state.line,
        state.column,
      ),
      mode: "Error",
      isComplete: false,
    };
  }

  const value = Number(node.buffer);
  return closePrimitiveNode(state, nodeId, value);
}

/**
 * Finalizes a completed literal token (true/false/null).
 *
 * @param state - Current parser state.
 * @param nodeId - Literal node id to finalize.
 * @param expected - Expected literal string.
 * @returns Updated parser state.
 */
function finalizeLiteral(
  state: ParserState,
  nodeId: number,
  expected: string,
): ParserState {
  if (expected === "true") {
    return closePrimitiveNode(state, nodeId, true);
  }
  if (expected === "false") {
    return closePrimitiveNode(state, nodeId, false);
  }

  return closePrimitiveNode(state, nodeId, null);
}

/**
 * Parses a chunk of JSON text and returns the next parser state.
 *
 * @param state - Current parser state.
 * @param chunk - JSON text chunk to parse.
 * @returns Updated parser state after consuming the chunk.
 */
function parseHashbrownChunk(state: ParserState, chunk: string): ParserState {
  if (state.error) {
    return state;
  }

  let nextState = { ...state };
  let i = 0;

  while (i < chunk.length) {
    const ch = chunk[i];
    const currentIndex = nextState.index;
    const currentLine = nextState.line;
    const currentColumn = nextState.column;

    /**
     * Records an error at the current position.
     */
    function setError(message: string) {
      nextState = {
        ...nextState,
        error: createError(message, currentIndex, currentLine, currentColumn),
        mode: "Error",
        isComplete: false,
      };
    }

    /**
     * Advances the parser's absolute position counters for the current character.
     */
    function consume() {
      nextState = {
        ...nextState,
        index: currentIndex + 1,
        line: ch === "\n" ? currentLine + 1 : currentLine,
        column: ch === "\n" ? 1 : currentColumn + 1,
      };
    }

    if (nextState.mode === "Error") {
      break;
    }

    if (nextState.mode === "Done") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      setError("Unexpected trailing token");
      break;
    }

    if (nextState.mode === "String") {
      if (nextState.stringUnicode !== null) {
        if (!isHexDigit(ch)) {
          setError("Invalid unicode escape");
          break;
        }

        const nextUnicode = nextState.stringUnicode + ch;
        if (nextUnicode.length === 4) {
          const codePoint = Number.parseInt(nextUnicode, 16);
          if (
            nextState.stringContext === "value" &&
            nextState.currentNodeId === null
          ) {
            setError("Missing string node");
            break;
          }

          nextState = appendStringFragment(
            nextState,
            String.fromCharCode(codePoint),
          );
          nextState = { ...nextState, stringUnicode: null };
        } else {
          nextState = { ...nextState, stringUnicode: nextUnicode };
        }

        consume();
        i += 1;
        continue;
      }

      if (nextState.stringEscape) {
        if (ch === "u") {
          nextState = { ...nextState, stringEscape: false, stringUnicode: "" };
          consume();
          i += 1;
          continue;
        }

        const mapped = stringEscapeMap[ch];
        if (!mapped) {
          setError("Invalid escape sequence");
          break;
        }

        if (
          nextState.stringContext === "value" &&
          nextState.currentNodeId === null
        ) {
          setError("Missing string node");
          break;
        }

        nextState = appendStringFragment(nextState, mapped);
        nextState = { ...nextState, stringEscape: false };

        consume();
        i += 1;
        continue;
      }

      if (ch === "\\") {
        nextState = { ...nextState, stringEscape: true };
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        if (nextState.stringContext === "value") {
          if (nextState.currentNodeId === null) {
            setError("Missing string node");
            break;
          }

          nextState = closePrimitiveNode(
            {
              ...nextState,
              currentNodeId: null,
              stringEscape: false,
              stringUnicode: null,
            },
            nextState.currentNodeId,
            (nextState.nodes[nextState.currentNodeId] as JsonStringAstNode)
              .buffer,
          );
          const result = afterValue(nextState.stack);
          nextState = {
            ...nextState,
            mode: result.mode,
            isComplete: result.isComplete,
          };
        } else {
          const topId = nextState.stack[nextState.stack.length - 1] ?? null;
          if (topId === null) {
            setError("Object key outside of object");
            break;
          }

          nextState = {
            ...nextState,
            pendingKey: nextState.keyBuffer,
            pendingKeyOwner: topId,
            keyBuffer: "",
            mode: "ObjectColon",
            stringContext: null,
            stringEscape: false,
            stringUnicode: null,
          };
        }

        nextState = {
          ...nextState,
          stringContext: null,
          stringEscape: false,
          stringUnicode: null,
        };
        consume();
        i += 1;
        continue;
      }

      if (ch < " ") {
        setError("Invalid string character");
        break;
      }

      if (
        nextState.stringContext === "value" &&
        nextState.currentNodeId === null
      ) {
        setError("Missing string node");
        break;
      }

      nextState = appendStringFragment(nextState, ch);

      consume();
      i += 1;
      continue;
    }

    if (nextState.mode === "Number") {
      if (isNumberChar(ch)) {
        if (nextState.currentNodeId === null) {
          setError("Missing number node");
          break;
        }

        const node = nextState.nodes[
          nextState.currentNodeId
        ] as JsonNumberAstNode;
        const updated = { ...node, buffer: node.buffer + ch };
        const nodes = replaceNode(
          nextState.nodes,
          nextState.currentNodeId,
          updated,
        );
        nextState = { ...nextState, nodes };
        consume();
        i += 1;
        continue;
      }

      if (nextState.currentNodeId === null) {
        setError("Missing number node");
        break;
      }

      nextState = finalizeNumber(nextState, nextState.currentNodeId);
      if (nextState.error) {
        break;
      }

      nextState = { ...nextState, currentNodeId: null };
      const result = afterValue(nextState.stack);
      nextState = {
        ...nextState,
        mode: result.mode,
        isComplete: result.isComplete,
      };
      continue;
    }

    if (nextState.mode === "Literal") {
      const expected = nextState.literalExpected;
      if (!expected) {
        setError("Missing literal expectation");
        break;
      }

      const position = nextState.literalBuffer.length;
      if (expected[position] !== ch) {
        setError("Invalid literal");
        break;
      }

      const buffer = nextState.literalBuffer + ch;
      nextState = { ...nextState, literalBuffer: buffer };
      consume();
      i += 1;

      if (buffer.length === expected.length) {
        if (nextState.currentNodeId === null) {
          setError("Missing literal node");
          break;
        }

        nextState = finalizeLiteral(
          nextState,
          nextState.currentNodeId,
          expected,
        );
        if (nextState.error) {
          break;
        }

        const result = afterValue(nextState.stack);
        nextState = {
          ...nextState,
          mode: result.mode,
          isComplete: result.isComplete,
          literalExpected: null,
          literalBuffer: "",
          currentNodeId: null,
        };
      }

      continue;
    }

    if (nextState.mode === "Value") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        const opened = openNode(nextState, "string");
        nextState = {
          ...opened.state,
          mode: "String",
          stringContext: "value",
          stringEscape: false,
          stringUnicode: null,
          currentNodeId: opened.nodeId,
        };
        if (nextState.error) {
          break;
        }
        consume();
        i += 1;
        continue;
      }

      if (ch === "{") {
        const opened = openNode(nextState, "object");
        nextState = { ...opened.state, mode: "ObjectKeyOrEnd" };
        if (nextState.error) {
          break;
        }
        consume();
        i += 1;
        continue;
      }

      if (ch === "[") {
        const opened = openNode(nextState, "array");
        nextState = { ...opened.state, mode: "ArrayValueOrEnd" };
        if (nextState.error) {
          break;
        }
        consume();
        i += 1;
        continue;
      }

      if (ch === "-" || (ch >= "0" && ch <= "9")) {
        const opened = openNode(nextState, "number");
        nextState = {
          ...opened.state,
          mode: "Number",
          currentNodeId: opened.nodeId,
        };
        if (nextState.error) {
          break;
        }

        const node = nextState.nodes[opened.nodeId] as JsonNumberAstNode;
        const updated = { ...node, buffer: node.buffer + ch };
        const nodes = replaceNode(nextState.nodes, opened.nodeId, updated);
        nextState = { ...nextState, nodes };
        consume();
        i += 1;
        continue;
      }

      if (ch === "t" || ch === "f" || ch === "n") {
        const type = ch === "n" ? "null" : "boolean";
        const opened = openNode(nextState, type);
        if (opened.state.error) {
          nextState = opened.state;
          break;
        }

        const expected = ch === "t" ? "true" : ch === "f" ? "false" : "null";
        nextState = {
          ...opened.state,
          mode: "Literal",
          literalExpected: expected,
          literalBuffer: ch,
          currentNodeId: opened.nodeId,
        };
        consume();
        i += 1;
        continue;
      }

      setError("Unexpected token");
      break;
    }

    if (
      nextState.mode === "ArrayValueOrEnd" ||
      nextState.mode === "ArrayValue"
    ) {
      const allowEnd = nextState.mode === "ArrayValueOrEnd";
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (allowEnd && ch === "]") {
        const arrayId = nextState.stack[nextState.stack.length - 1];
        nextState = closeContainerAndAdvance(nextState, arrayId);
        consume();
        i += 1;
        continue;
      }

      nextState = { ...nextState, mode: "Value" };
      continue;
    }

    if (nextState.mode === "ObjectKeyOrEnd") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === "}") {
        const objectId = nextState.stack[nextState.stack.length - 1];
        nextState = closeContainerAndAdvance(nextState, objectId);
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        nextState = startObjectKeyString(nextState);
        consume();
        i += 1;
        continue;
      }

      setError("Unexpected token in object");
      break;
    }

    if (nextState.mode === "ObjectKey") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        nextState = startObjectKeyString(nextState);
        consume();
        i += 1;
        continue;
      }

      setError("Unexpected token in object");
      break;
    }

    if (nextState.mode === "ObjectColon") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === ":") {
        nextState = { ...nextState, mode: "Value" };
        consume();
        i += 1;
        continue;
      }

      setError("Expected colon");
      break;
    }

    if (nextState.mode === "CommaOrEnd") {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      const containerId = nextState.stack[nextState.stack.length - 1];
      const container = nextState.nodes[containerId] as JsonAstNode | undefined;
      if (!container) {
        setError("Missing container");
        break;
      }

      if (container.type === "array") {
        if (ch === ",") {
          nextState = { ...nextState, mode: "ArrayValue" };
          consume();
          i += 1;
          continue;
        }

        if (ch === "]") {
          nextState = closeContainerAndAdvance(nextState, containerId);
          consume();
          i += 1;
          continue;
        }

        setError("Expected comma or closing bracket");
        break;
      }

      if (container.type === "object") {
        if (ch === ",") {
          nextState = { ...nextState, mode: "ObjectKey" };
          consume();
          i += 1;
          continue;
        }

        if (ch === "}") {
          nextState = closeContainerAndAdvance(nextState, containerId);
          consume();
          i += 1;
          continue;
        }

        setError("Expected comma or closing brace");
        break;
      }

      setError("Invalid container for comma");
      break;
    }

    setError("Invalid parser state");
    break;
  }

  return nextState;
}

/**
 * Finalizes parsing at end-of-stream, returning an error if JSON is incomplete.
 *
 * @param state - Current parser state.
 * @returns Updated parser state after end-of-stream handling.
 */
function finalizeHashbrownJsonParse(state: ParserState): ParserState {
  if (state.error) {
    return state;
  }

  if (state.mode === "Done") {
    return { ...state, isComplete: true };
  }

  if (state.mode === "Number") {
    if (state.currentNodeId === null) {
      return {
        ...state,
        error: createError(
          "Missing number node",
          state.index,
          state.line,
          state.column,
        ),
        mode: "Error",
        isComplete: false,
      };
    }

    const next = finalizeNumber(state, state.currentNodeId);
    if (next.error) {
      return next;
    }

    const result = afterValue(next.stack);
    if (result.mode !== "Done") {
      return {
        ...next,
        error: createError(
          "Unexpected end of JSON input",
          next.index,
          next.line,
          next.column,
        ),
        mode: "Error",
        isComplete: false,
        currentNodeId: null,
      };
    }

    return {
      ...next,
      mode: result.mode,
      isComplete: result.isComplete,
      currentNodeId: null,
    };
  }

  if (state.mode === "Literal") {
    if (
      !state.literalExpected ||
      state.literalBuffer.length !== state.literalExpected.length
    ) {
      return {
        ...state,
        error: createError(
          "Unexpected end of JSON input",
          state.index,
          state.line,
          state.column,
        ),
        mode: "Error",
        isComplete: false,
      };
    }

    if (state.currentNodeId === null) {
      return {
        ...state,
        error: createError(
          "Missing literal node",
          state.index,
          state.line,
          state.column,
        ),
        mode: "Error",
        isComplete: false,
      };
    }

    const next = finalizeLiteral(
      state,
      state.currentNodeId,
      state.literalExpected,
    );
    if (next.error) {
      return next;
    }

    const result = afterValue(next.stack);
    if (result.mode !== "Done") {
      return {
        ...next,
        error: createError(
          "Unexpected end of JSON input",
          next.index,
          next.line,
          next.column,
        ),
        mode: "Error",
        isComplete: false,
        currentNodeId: null,
        literalExpected: null,
        literalBuffer: "",
      };
    }

    return {
      ...next,
      mode: result.mode,
      isComplete: result.isComplete,
      currentNodeId: null,
      literalExpected: null,
      literalBuffer: "",
    };
  }

  if (state.mode === "String") {
    return {
      ...state,
      error: createError(
        "Unexpected end of JSON input",
        state.index,
        state.line,
        state.column,
      ),
      mode: "Error",
      isComplete: false,
    };
  }

  return {
    ...state,
    error: createError(
      "Unexpected end of JSON input",
      state.index,
      state.line,
      state.column,
    ),
    mode: "Error",
    isComplete: false,
  };
}

/**
 * Returns the fully resolved JSON value when parsing is complete and error-free.
 *
 * @param state - Current parser state.
 * @returns Resolved JSON value when complete, otherwise undefined.
 */
export function getResolvedValue(state: ParserState): JsonValue | undefined {
  if (state.error || !state.isComplete || state.rootId === null) {
    return undefined;
  }

  return state.nodes[state.rootId]?.resolvedValue as JsonValue | undefined;
}

function limitError(
  state: ParserState,
  code: "max_bytes" | "max_depth" | "max_nodes",
  limit: number,
  observed: number,
): ParserState {
  return {
    ...state,
    error: {
      code,
      message: `${code} limit exceeded: configured ${limit}, observed ${observed}`,
      index: state.index,
      line: state.line,
      column: state.column,
      limit,
      observed,
    },
    mode: "Error",
    isComplete: false,
  };
}

function observedDepth(nodes: readonly JsonAstNode[]): number {
  let maximum = 0;
  for (const node of nodes) {
    if (node.type !== "array" && node.type !== "object") {
      continue;
    }
    let depth = 1;
    let parentId = node.parentId;
    while (parentId !== null) {
      depth += 1;
      parentId = nodes[parentId]?.parentId ?? null;
    }
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}

/** Create immutable state for one streaming JSON document. */
export function createParserState(
  limits: Partial<ParserLimits> = {},
): ParserState {
  return {
    ...createHashbrownParserState(),
    limits: {
      maxBytes: limits.maxBytes ?? 65_536,
      maxDepth: limits.maxDepth ?? 32,
      maxNodes: limits.maxNodes ?? 10_000,
    },
  };
}

/** Parse one ordered JSON text delta and return replacement state. */
export function parseChunk(state: ParserState, chunk: string): ParserOperation {
  if (state.error) {
    return { state, error: state.error };
  }
  const rawText = state.rawText + chunk;
  const bytes = new TextEncoder().encode(rawText).byteLength;
  if (bytes > state.limits.maxBytes) {
    const next = limitError(
      { ...state, rawText },
      "max_bytes",
      state.limits.maxBytes,
      bytes,
    );
    return { state: next, error: next.error! };
  }

  let next = parseHashbrownChunk({ ...state, rawText }, chunk);
  if (!next.error && next.nodes.length > next.limits.maxNodes) {
    next = limitError(
      next,
      "max_nodes",
      next.limits.maxNodes,
      next.nodes.length,
    );
  }
  const depth = observedDepth(next.nodes);
  if (!next.error && depth > next.limits.maxDepth) {
    next = limitError(next, "max_depth", next.limits.maxDepth, depth);
  }
  return next.error ? { state: next, error: next.error } : { state: next };
}

/** Finalize one JSON document when no more deltas will arrive. */
export function finalizeJsonParse(state: ParserState): ParserOperation {
  const next = finalizeHashbrownJsonParse(state);
  return next.error ? { state: next, error: next.error } : { state: next };
}
