// Derived from hashbrown/packages/core/src/skillet/parser/json-parser.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * JSON-compatible value shape returned by the parser once complete.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON value that may be partially resolved while parsing.
 */
export type JsonResolvedValue =
  | null
  | boolean
  | number
  | string
  | JsonResolvedValue[]
  | { [key: string]: JsonResolvedValue }
  | undefined;

/**
 * AST node kinds produced by the streaming parser.
 */
export type JsonAstType =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';

/**
 * Shared fields for all AST node shapes.
 */
export type JsonAstBase = {
  id: number;
  type: JsonAstType;
  parentId: number | null;
  closed: boolean;
  resolvedValue: JsonResolvedValue;
};

/**
 * AST node representing a `null` literal.
 */
export type JsonNullAstNode = JsonAstBase & {
  type: 'null';
  resolvedValue: null | undefined;
};

/**
 * AST node representing a boolean literal.
 */
export type JsonBooleanAstNode = JsonAstBase & {
  type: 'boolean';
  resolvedValue: boolean | undefined;
};

/**
 * AST node representing a number literal, including its raw buffer.
 */
export type JsonNumberAstNode = JsonAstBase & {
  type: 'number';
  buffer: string;
  resolvedValue: number | undefined;
};

/**
 * AST node representing a string literal, including its raw buffer.
 */
export type JsonStringAstNode = JsonAstBase & {
  type: 'string';
  buffer: string;
  resolvedValue: string | undefined;
};

/**
 * AST node representing an array container.
 */
export type JsonArrayAstNode = JsonAstBase & {
  type: 'array';
  children: number[];
  resolvedValue: JsonResolvedValue[] | undefined;
};

/**
 * AST node representing an object container.
 */
export type JsonObjectAstNode = JsonAstBase & {
  type: 'object';
  keys: string[];
  children: number[];
  resolvedValue: Record<string, JsonResolvedValue> | undefined;
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
export type ParserError = {
  message: string;
  index: number;
  line: number;
  column: number;
};

/**
 * Internal parser mode that drives state transitions.
 */
export type ParseMode =
  | 'Value'
  | 'ArrayValue'
  | 'ArrayValueOrEnd'
  | 'ObjectKey'
  | 'ObjectKeyOrEnd'
  | 'ObjectColon'
  | 'CommaOrEnd'
  | 'String'
  | 'Number'
  | 'Literal'
  | 'Done'
  | 'Error';

/**
 * Complete immutable parser state for streaming JSON parsing.
 */
export type ParserState = {
  nextId: number;
  mode: ParseMode;
  stack: number[];
  nodes: JsonAstNode[];
  rootId: number | null;
  error: ParserError | null;
  isComplete: boolean;
  index: number;
  line: number;
  column: number;
  stringContext: 'value' | 'key' | null;
  stringEscape: boolean;
  stringUnicode: string | null;
  literalExpected: string | null;
  literalBuffer: string;
  pendingKey: string | null;
  pendingKeyOwner: number | null;
  currentNodeId: number | null;
  keyBuffer: string;
};

const numberPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const stringEscapeMap: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Returns true when the character is JSON whitespace.
 */
function isWhitespace(ch: string) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Returns true for characters that may appear in a JSON number literal.
 */
function isNumberChar(ch: string) {
  return (
    (ch >= '0' && ch <= '9') ||
    ch === '-' ||
    ch === '+' ||
    ch === '.' ||
    ch === 'e' ||
    ch === 'E'
  );
}

/**
 * Returns true for hexadecimal digits used in unicode escapes.
 */
function isHexDigit(ch: string) {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'f') ||
    (ch >= 'A' && ch <= 'F')
  );
}

/**
 * Returns a new nodes array with a single node replaced, preserving identity when unchanged.
 */
function replaceNode(nodes: JsonAstNode[], id: number, node: JsonAstNode) {
  if (nodes[id] === node) {
    return nodes;
  }

  const nextNodes = nodes.slice();
  nextNodes[id] = node;
  return nextNodes;
}

/**
 * Returns the previous array value if it is structurally identical to the new values.
 */
function appendArrayValue(arr: JsonResolvedValue[], values: JsonResolvedValue[]) {
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
 */
function appendObjectValue(
  obj: Record<string, JsonResolvedValue>,
  keys: string[],
  values: Record<string, JsonResolvedValue>,
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
 */
function recomputeContainerResolved(node: JsonAstNode, nodes: JsonAstNode[]) {
  if (node.type === 'array') {
    const values = node.children.map((childId) => nodes[childId].resolvedValue);
    const resolved = node.resolvedValue ? appendArrayValue(node.resolvedValue, values) : values;
    if (resolved === node.resolvedValue) {
      return node;
    }

    return { ...node, resolvedValue: resolved } as JsonArrayAstNode;
  }

  if (node.type === 'object') {
    const values: Record<string, JsonResolvedValue> = {};
    for (let i = 0; i < node.keys.length; i += 1) {
      const key = node.keys[i];
      values[key] = nodes[node.children[i]].resolvedValue;
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
 */
function propagateResolved(nodes: JsonAstNode[], startParentId: number | null) {
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
 */
function createError(
  message: string,
  index: number,
  line: number,
  column: number,
) {
  return {
    message,
    index,
    line,
    column,
  };
}

/**
 * Returns the next mode after a value is completed.
 */
function afterValue(stack: number[]) {
  if (stack.length === 0) {
    return { mode: 'Done' as const, isComplete: true };
  }

  return { mode: 'CommaOrEnd' as const, isComplete: false };
}

/**
 * Creates the initial parser state for a new JSON stream.
 */
export function createParserState(): ParserState {
  return {
    nextId: 0,
    mode: 'Value',
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
    literalBuffer: '',
    pendingKey: null,
    pendingKeyOwner: null,
    currentNodeId: null,
    keyBuffer: '',
  };
}

/**
 * Opens a new AST node and attaches it to the current container when applicable.
 */
function openNode(
  state: ParserState,
  type: JsonAstType,
): {
  state: ParserState;
  nodeId: number;
} {
  const id = state.nextId;
  const parentId = state.stack.length ? state.stack[state.stack.length - 1] : null;
  if (state.rootId !== null && parentId === null) {
    return {
      state: {
        ...state,
        error: createError('Unexpected token after root value', state.index, state.line, state.column),
        mode: 'Error',
        isComplete: false,
      },
      nodeId: -1,
    };
  }

  let node: JsonAstNode;
  switch (type) {
    case 'string':
      node = { id, type, parentId, closed: false, resolvedValue: undefined, buffer: '' };
      break;
    case 'number':
      node = { id, type, parentId, closed: false, resolvedValue: undefined, buffer: '' };
      break;
    case 'array':
      node = {
        id,
        type,
        parentId,
        closed: false,
        resolvedValue: [],
        children: [],
      };
      break;
    case 'object':
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
    case 'boolean':
      node = { id, type, parentId, closed: false, resolvedValue: undefined };
      break;
    case 'null':
      node = { id, type, parentId, closed: false, resolvedValue: undefined };
      break;
  }

  let nodes = state.nodes.slice();
  nodes[id] = node;

  let stack = state.stack;
  let pendingKey = state.pendingKey;
  let pendingKeyOwner = state.pendingKeyOwner;

  if (parentId !== null) {
    const parent = nodes[parentId];
    if (parent.type === 'array') {
      const children = parent.children.concat(id);
      const updatedParent: JsonArrayAstNode = {
        ...parent,
        children,
      };
      nodes = replaceNode(nodes, parentId, updatedParent);
      nodes = propagateResolved(nodes, parentId);
    } else if (parent.type === 'object') {
      if (!pendingKey || pendingKeyOwner !== parentId) {
        return {
          state: {
            ...state,
            error: createError('Missing object key before value', state.index, state.line, state.column),
            mode: 'Error',
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

  if (type === 'array' || type === 'object') {
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
 */
function closePrimitiveNode(
  state: ParserState,
  nodeId: number,
  value: JsonValue,
) {
  const node = state.nodes[nodeId];
  const updated = { ...node, closed: true, resolvedValue: value } as JsonAstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);

  return { ...state, nodes };
}

/**
 * Closes an array or object node and updates resolved values up the tree.
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
 */
function appendStringFragment(state: ParserState, fragment: string): ParserState {
  if (state.stringContext === 'value') {
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
 */
function startObjectKeyString(state: ParserState): ParserState {
  return {
    ...state,
    mode: 'String',
    stringContext: 'key',
    stringEscape: false,
    stringUnicode: null,
    keyBuffer: '',
  };
}

/**
 * Closes a container and updates the parser mode based on the new stack.
 */
function closeContainerAndAdvance(state: ParserState, nodeId: number): ParserState {
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
 */
function finalizeNumber(state: ParserState, nodeId: number): ParserState {
  const node = state.nodes[nodeId];
  if (node.type !== 'number') {
    return state;
  }

  if (!numberPattern.test(node.buffer)) {
    return {
      ...state,
      error: createError('Invalid number', state.index, state.line, state.column),
      mode: 'Error',
      isComplete: false,
    };
  }

  const value = Number(node.buffer);
  return closePrimitiveNode(state, nodeId, value);
}

/**
 * Finalizes a completed literal token (true/false/null).
 */
function finalizeLiteral(state: ParserState, nodeId: number, expected: string): ParserState {
  if (expected === 'true') {
    return closePrimitiveNode(state, nodeId, true);
  }
  if (expected === 'false') {
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
export function parseChunk(state: ParserState, chunk: string): ParserState {
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
        mode: 'Error',
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
        line: ch === '\n' ? currentLine + 1 : currentLine,
        column: ch === '\n' ? 1 : currentColumn + 1,
      };
    }

    if (nextState.mode === 'Error') {
      break;
    }

    if (nextState.mode === 'Done') {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      setError('Unexpected trailing token');
      break;
    }

    if (nextState.mode === 'String') {
      if (nextState.stringUnicode !== null) {
        if (!isHexDigit(ch)) {
          setError('Invalid unicode escape');
          break;
        }

        const nextUnicode = nextState.stringUnicode + ch;
        if (nextUnicode.length === 4) {
          const codePoint = Number.parseInt(nextUnicode, 16);
          if (nextState.stringContext === 'value' && nextState.currentNodeId === null) {
            setError('Missing string node');
            break;
          }

          nextState = appendStringFragment(nextState, String.fromCharCode(codePoint));
          nextState = { ...nextState, stringUnicode: null };
        } else {
          nextState = { ...nextState, stringUnicode: nextUnicode };
        }

        consume();
        i += 1;
        continue;
      }

      if (nextState.stringEscape) {
        if (ch === 'u') {
          nextState = { ...nextState, stringEscape: false, stringUnicode: '' };
          consume();
          i += 1;
          continue;
        }

        const mapped = stringEscapeMap[ch];
        if (!mapped) {
          setError('Invalid escape sequence');
          break;
        }

        if (nextState.stringContext === 'value' && nextState.currentNodeId === null) {
          setError('Missing string node');
          break;
        }

        nextState = appendStringFragment(nextState, mapped);
        nextState = { ...nextState, stringEscape: false };

        consume();
        i += 1;
        continue;
      }

      if (ch === '\\') {
        nextState = { ...nextState, stringEscape: true };
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        if (nextState.stringContext === 'value') {
          if (nextState.currentNodeId === null) {
            setError('Missing string node');
            break;
          }

          nextState = closePrimitiveNode(
            { ...nextState, currentNodeId: null, stringEscape: false, stringUnicode: null },
            nextState.currentNodeId,
            (nextState.nodes[nextState.currentNodeId] as JsonStringAstNode).buffer,
          );
          const result = afterValue(nextState.stack);
          nextState = { ...nextState, mode: result.mode, isComplete: result.isComplete };
        } else {
          const topId = nextState.stack[nextState.stack.length - 1] ?? null;
          if (topId === null) {
            setError('Object key outside of object');
            break;
          }

          nextState = {
            ...nextState,
            pendingKey: nextState.keyBuffer,
            pendingKeyOwner: topId,
            keyBuffer: '',
            mode: 'ObjectColon',
            stringContext: null,
            stringEscape: false,
            stringUnicode: null,
          };
        }

        nextState = { ...nextState, stringContext: null, stringEscape: false, stringUnicode: null };
        consume();
        i += 1;
        continue;
      }

      if (ch < ' ') {
        setError('Invalid string character');
        break;
      }

        if (nextState.stringContext === 'value' && nextState.currentNodeId === null) {
          setError('Missing string node');
          break;
        }

        nextState = appendStringFragment(nextState, ch);

      consume();
      i += 1;
      continue;
    }

    if (nextState.mode === 'Number') {
      if (isNumberChar(ch)) {
        if (nextState.currentNodeId === null) {
          setError('Missing number node');
          break;
        }

        const node = nextState.nodes[nextState.currentNodeId] as JsonNumberAstNode;
        const updated = { ...node, buffer: node.buffer + ch };
        const nodes = replaceNode(nextState.nodes, nextState.currentNodeId, updated);
        nextState = { ...nextState, nodes };
        consume();
        i += 1;
        continue;
      }

      if (nextState.currentNodeId === null) {
        setError('Missing number node');
        break;
      }

      nextState = finalizeNumber(nextState, nextState.currentNodeId);
      if (nextState.error) {
        break;
      }

      nextState = { ...nextState, currentNodeId: null };
      const result = afterValue(nextState.stack);
      nextState = { ...nextState, mode: result.mode, isComplete: result.isComplete };
      continue;
    }

    if (nextState.mode === 'Literal') {
      const expected = nextState.literalExpected;
      if (!expected) {
        setError('Missing literal expectation');
        break;
      }

      const position = nextState.literalBuffer.length;
      if (expected[position] !== ch) {
        setError('Invalid literal');
        break;
      }

      const buffer = nextState.literalBuffer + ch;
      nextState = { ...nextState, literalBuffer: buffer };
      consume();
      i += 1;

      if (buffer.length === expected.length) {
        if (nextState.currentNodeId === null) {
          setError('Missing literal node');
          break;
        }

        nextState = finalizeLiteral(nextState, nextState.currentNodeId, expected);
        if (nextState.error) {
          break;
        }

        const result = afterValue(nextState.stack);
        nextState = {
          ...nextState,
          mode: result.mode,
          isComplete: result.isComplete,
          literalExpected: null,
          literalBuffer: '',
          currentNodeId: null,
        };
      }

      continue;
    }

    if (nextState.mode === 'Value') {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === '"') {
        const opened = openNode(nextState, 'string');
        nextState = {
          ...opened.state,
          mode: 'String',
          stringContext: 'value',
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

      if (ch === '{') {
        const opened = openNode(nextState, 'object');
        nextState = { ...opened.state, mode: 'ObjectKeyOrEnd' };
        if (nextState.error) {
          break;
        }
        consume();
        i += 1;
        continue;
      }

      if (ch === '[') {
        const opened = openNode(nextState, 'array');
        nextState = { ...opened.state, mode: 'ArrayValueOrEnd' };
        if (nextState.error) {
          break;
        }
        consume();
        i += 1;
        continue;
      }

      if (ch === '-' || (ch >= '0' && ch <= '9')) {
        const opened = openNode(nextState, 'number');
        nextState = {
          ...opened.state,
          mode: 'Number',
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

      if (ch === 't' || ch === 'f' || ch === 'n') {
        const type = ch === 'n' ? 'null' : 'boolean';
        const opened = openNode(nextState, type);
        if (opened.state.error) {
          nextState = opened.state;
          break;
        }

        const expected = ch === 't' ? 'true' : ch === 'f' ? 'false' : 'null';
        nextState = {
          ...opened.state,
          mode: 'Literal',
          literalExpected: expected,
          literalBuffer: ch,
          currentNodeId: opened.nodeId,
        };
        consume();
        i += 1;
        continue;
      }

      setError('Unexpected token');
      break;
    }

    if (nextState.mode === 'ArrayValueOrEnd' || nextState.mode === 'ArrayValue') {
      const allowEnd = nextState.mode === 'ArrayValueOrEnd';
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (allowEnd && ch === ']') {
        const arrayId = nextState.stack[nextState.stack.length - 1];
        nextState = closeContainerAndAdvance(nextState, arrayId);
        consume();
        i += 1;
        continue;
      }

      nextState = { ...nextState, mode: 'Value' };
      continue;
    }

    if (nextState.mode === 'ObjectKeyOrEnd') {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === '}') {
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

      setError('Unexpected token in object');
      break;
    }

    if (nextState.mode === 'ObjectKey') {
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

      setError('Unexpected token in object');
      break;
    }

    if (nextState.mode === 'ObjectColon') {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      if (ch === ':') {
        nextState = { ...nextState, mode: 'Value' };
        consume();
        i += 1;
        continue;
      }

      setError('Expected colon');
      break;
    }

    if (nextState.mode === 'CommaOrEnd') {
      if (isWhitespace(ch)) {
        consume();
        i += 1;
        continue;
      }

      const containerId = nextState.stack[nextState.stack.length - 1];
      const container = nextState.nodes[containerId] as JsonAstNode | undefined;
      if (!container) {
        setError('Missing container');
        break;
      }

      if (container.type === 'array') {
        if (ch === ',') {
          nextState = { ...nextState, mode: 'ArrayValue' };
          consume();
          i += 1;
          continue;
        }

        if (ch === ']') {
          nextState = closeContainerAndAdvance(nextState, containerId);
          consume();
          i += 1;
          continue;
        }

        setError('Expected comma or closing bracket');
        break;
      }

      if (container.type === 'object') {
        if (ch === ',') {
          nextState = { ...nextState, mode: 'ObjectKey' };
          consume();
          i += 1;
          continue;
        }

        if (ch === '}') {
          nextState = closeContainerAndAdvance(nextState, containerId);
          consume();
          i += 1;
          continue;
        }

        setError('Expected comma or closing brace');
        break;
      }

      setError('Invalid container for comma');
      break;
    }

    setError('Invalid parser state');
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
export function finalizeJsonParse(state: ParserState): ParserState {
  if (state.error) {
    return state;
  }

  if (state.mode === 'Done') {
    return { ...state, isComplete: true };
  }

  if (state.mode === 'Number') {
    if (state.currentNodeId === null) {
      return {
        ...state,
        error: createError('Missing number node', state.index, state.line, state.column),
        mode: 'Error',
        isComplete: false,
      };
    }

    const next = finalizeNumber(state, state.currentNodeId);
    if (next.error) {
      return next;
    }

    const result = afterValue(next.stack);
    if (result.mode !== 'Done') {
      return {
        ...next,
        error: createError('Unexpected end of JSON input', next.index, next.line, next.column),
        mode: 'Error',
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

  if (state.mode === 'Literal') {
    if (!state.literalExpected || state.literalBuffer.length !== state.literalExpected.length) {
      return {
        ...state,
        error: createError('Unexpected end of JSON input', state.index, state.line, state.column),
        mode: 'Error',
        isComplete: false,
      };
    }

    if (state.currentNodeId === null) {
      return {
        ...state,
        error: createError('Missing literal node', state.index, state.line, state.column),
        mode: 'Error',
        isComplete: false,
      };
    }

    const next = finalizeLiteral(state, state.currentNodeId, state.literalExpected);
    if (next.error) {
      return next;
    }

    const result = afterValue(next.stack);
    if (result.mode !== 'Done') {
      return {
        ...next,
        error: createError('Unexpected end of JSON input', next.index, next.line, next.column),
        mode: 'Error',
        isComplete: false,
        currentNodeId: null,
        literalExpected: null,
        literalBuffer: '',
      };
    }

    return {
      ...next,
      mode: result.mode,
      isComplete: result.isComplete,
      currentNodeId: null,
      literalExpected: null,
      literalBuffer: '',
    };
  }

  if (state.mode === 'String') {
    return {
      ...state,
      error: createError('Unexpected end of JSON input', state.index, state.line, state.column),
      mode: 'Error',
      isComplete: false,
    };
  }

  return {
    ...state,
    error: createError('Unexpected end of JSON input', state.index, state.line, state.column),
    mode: 'Error',
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
