export interface ExtractedRenderUIArgs {
  target?: string;
  /**
   * Complete elements of the `operations` array, in order. A balanced element
   * that is not a valid JSON object is returned as `null`.
   */
  operations: Array<Record<string, unknown> | null>;
  /**
   * Set when an `operations[]` element was opened but its closing brace never
   * arrived: the text ends mid-operation (still streaming, or truncated).
   */
  incompleteOperation?: boolean;
}

/**
 * Reads `target` and every complete `operations[]` element from a possibly
 * truncated `render_ui` argument string. Rescans from the start on each call;
 * argument payloads are small enough that this stays cheap.
 */
export function extractRenderUIArgs(text: string): ExtractedRenderUIArgs {
  const result: ExtractedRenderUIArgs = { operations: [] };
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let pendingKey: string | null = null;
  let currentKey: string | null = null;
  let expectingValue = false;
  let inOperations = false;
  let elementStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        if (stack.length === 1) {
          const literal = text.slice(stringStart, i + 1);
          if (expectingValue) {
            if (currentKey === "target") {
              try {
                result.target = JSON.parse(literal);
              } catch {
                // Unreachable for a closed literal; keep scanning.
              }
            }
            expectingValue = false;
          } else {
            pendingKey = literal;
          }
        }
      }
      continue;
    }
    switch (ch) {
      case '"':
        inString = true;
        stringStart = i;
        break;
      case ":":
        if (stack.length === 1 && pendingKey !== null) {
          try {
            currentKey = JSON.parse(pendingKey);
          } catch {
            currentKey = null;
          }
          pendingKey = null;
          expectingValue = true;
        }
        break;
      case ",":
        if (stack.length === 1) {
          expectingValue = false;
          currentKey = null;
        }
        break;
      case "{":
        if (inOperations && stack.length === 2) elementStart = i;
        stack.push("{");
        break;
      case "[":
        if (
          stack.length === 1 &&
          expectingValue &&
          currentKey === "operations"
        ) {
          inOperations = true;
        }
        stack.push("[");
        break;
      case "}":
      case "]":
        stack.pop();
        if (
          ch === "}" &&
          inOperations &&
          stack.length === 2 &&
          elementStart >= 0
        ) {
          result.operations.push(parseObject(text.slice(elementStart, i + 1)));
          elementStart = -1;
        }
        if (ch === "]" && inOperations && stack.length === 1) {
          inOperations = false;
          expectingValue = false;
        }
        break;
    }
  }
  if (elementStart >= 0) result.incompleteOperation = true;
  return result;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Feeds streamed argument deltas and reports operations not yet seen. */
export class RenderUIArgsStream {
  private buffer = "";
  private emitted = 0;
  private incomplete = false;

  push(delta: string): {
    target?: string;
    newOperations: Array<Record<string, unknown> | null>;
  } {
    this.buffer += delta;
    const { target, operations, incompleteOperation } = extractRenderUIArgs(
      this.buffer,
    );
    const newOperations = operations.slice(this.emitted);
    this.emitted = operations.length;
    this.incomplete = incompleteOperation === true;
    return { target, newOperations };
  }

  /** Every argument delta received so far, concatenated. */
  get text(): string {
    return this.buffer;
  }

  /**
   * True when the text received so far ends inside an `operations[]` element.
   * Once the tool call has ended, that element was truncated.
   */
  get hasIncompleteOperation(): boolean {
    return this.incomplete;
  }
}
