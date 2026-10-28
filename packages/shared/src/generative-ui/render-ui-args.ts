import { isRecord } from "./is-record";
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
 * truncated `render_ui` argument string.
 */
export function extractRenderUIArgs(text: string) {
  return new RenderUIArgsScanner().scan(text);
}

/**
 * The parser of {@link extractRenderUIArgs}, with its state kept between
 * calls. Each call scans only the text after the text it scanned before, so
 * a streamed argument string is scanned once in total.
 */
class RenderUIArgsScanner {
  private readonly result: ExtractedRenderUIArgs = { operations: [] };
  private readonly stack: Array<"{" | "["> = [];
  private inString = false;
  private escaped = false;
  private stringStart = -1;
  private pendingKey: string | null = null;
  private currentKey: string | null = null;
  private expectingValue = false;
  private inOperations = false;
  private elementStart = -1;
  private scanned = 0;

  /**
   * Scans `text` from where the last call stopped.
   *
   * @param text - The whole text so far. It starts with the text of the
   *   last call.
   * @returns The result so far. It is the same object on each call.
   */
  scan(text: string) {
    const { result, stack } = this;
    let {
      inString,
      escaped,
      stringStart,
      pendingKey,
      currentKey,
      expectingValue,
      inOperations,
      elementStart,
    } = this;
    for (let i = this.scanned; i < text.length; i++) {
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
            result.operations.push(
              parseObject(text.slice(elementStart, i + 1)),
            );
            elementStart = -1;
          }
          if (ch === "]" && inOperations && stack.length === 1) {
            inOperations = false;
            expectingValue = false;
          }
          break;
      }
    }
    this.inString = inString;
    this.escaped = escaped;
    this.stringStart = stringStart;
    this.pendingKey = pendingKey;
    this.currentKey = currentKey;
    this.expectingValue = expectingValue;
    this.inOperations = inOperations;
    this.elementStart = elementStart;
    this.scanned = text.length;
    if (elementStart >= 0) result.incompleteOperation = true;
    else delete result.incompleteOperation;
    return result;
  }
}

function parseObject(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Feeds streamed argument deltas and reports operations not yet seen. */
export class RenderUIArgsStream {
  private buffer = "";
  private emitted = 0;
  private incomplete = false;
  private readonly scanner = new RenderUIArgsScanner();

  push(delta: string) {
    this.buffer += delta;
    const { target, operations, incompleteOperation } = this.scanner.scan(
      this.buffer,
    );
    const newOperations = operations.slice(this.emitted);
    this.emitted = operations.length;
    this.incomplete = incompleteOperation === true;
    return { target, newOperations };
  }

  /** Every argument delta received so far, concatenated. */
  get text() {
    return this.buffer;
  }

  /**
   * True when the text received so far ends inside an `operations[]` element.
   * Once the tool call has ended, that element was truncated.
   */
  get hasIncompleteOperation() {
    return this.incomplete;
  }
}
