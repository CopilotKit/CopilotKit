/**
 * A small streaming JSON scanner for `ArgsParser`.
 *
 * - `write(chunk)` accepts any split of the text. A token can be split
 *   anywhere, also inside a `\uXXXX` escape.
 * - It fires events for objects, arrays, keys and scalar values.
 * - While it reads a string value, `partialString` holds the decoded text so far.
 * - On bad input it skips the bad character or token, warns one time per
 *   instance, and continues. Later values still arrive.
 *
 * This module is internal. Do not export it from `event-transforms/index.ts`.
 */

export type JsonScalar = string | number | boolean | null;

export interface StreamingJsonHandlers {
  onOpenObject?(): void;
  /** Fires for every key, also for the first key of an object. */
  onKey?(key: string): void;
  onValue?(value: JsonScalar): void;
  onOpenArray?(): void;
  onCloseArray?(): void;
  onCloseObject?(): void;
}

type Container = "object" | "array";

/** What the scanner accepts next when it is not inside a token. */
type Expect =
  | "value"
  | "valueOrClose"
  | "key"
  | "keyOrClose"
  | "colon"
  | "commaOrClose";

/** The multi-character token that the scanner reads now, if any. */
type Token =
  | { kind: "none" }
  | { kind: "string"; isKey: boolean; text: string; escape: EscapeState }
  | { kind: "number"; text: string }
  | { kind: "literal"; text: string };

type EscapeState =
  | { kind: "none" }
  | { kind: "backslash" }
  | { kind: "unicode"; hex: string };

const NO_TOKEN: Token = { kind: "none" };
const NO_ESCAPE: EscapeState = { kind: "none" };

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const LITERALS: Record<string, JsonScalar> = {
  true: true,
  false: false,
  null: null,
};

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const NUMBER_CHAR = /[0-9+\-.eE]/;
const LITERAL_CHAR = /[a-z]/;
const NUMBER_START = /[-0-9]/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const WHITESPACE = /[ \t\n\r]/;

function defaultWarn(message: string) {
  console.warn(`[OpenGenerativeUI] ${message}`);
}

/** True when the UTF-16 code unit is the first half of a surrogate pair. */
function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

export class StreamingJsonScanner {
  private readonly handlers: StreamingJsonHandlers;
  private readonly onWarn: (message: string) => void;
  private readonly stack: Container[] = [];
  private expect: Expect = "value";
  private token: Token = NO_TOKEN;
  private hasWarned = false;
  /** Count of characters read before the current chunk. Used in warnings. */
  private offset = 0;

  /**
   * @param handlers - The events to fire. All handlers are optional.
   * @param onWarn - Gets one message on the first bad input. The default
   *   writes it with `console.warn` and the prefix `[OpenGenerativeUI]`.
   */
  constructor(
    handlers: StreamingJsonHandlers,
    onWarn: (message: string) => void = defaultWarn,
  ) {
    this.handlers = handlers;
    this.onWarn = onWarn;
  }

  /** Decoded text of the string value being read now, or undefined when not inside a string value. */
  get partialString() {
    const token = this.token;
    if (token.kind !== "string" || token.isKey) return undefined;
    // Hide a first surrogate half until its second half arrives, so a
    // reader never sees half of an emoji.
    const endsInHalfPair =
      token.text.length > 0 &&
      isHighSurrogate(token.text.charCodeAt(token.text.length - 1));
    return endsInHalfPair ? token.text.slice(0, -1) : token.text;
  }

  write(chunk: string) {
    let index = 0;
    while (index < chunk.length) {
      const token = this.token;
      const isPlainString =
        token.kind === "string" && token.escape.kind === "none";
      if (isPlainString) {
        // Copy a run of plain characters in one step. This keeps long
        // strings (such as streamed html) fast.
        const runEnd = findStringRunEnd(chunk, index);
        token.text += chunk.slice(index, runEnd);
        index = runEnd;
        if (index >= chunk.length) break;
      }
      this.readChar(chunk[index], this.offset + index);
      index++;
    }
    this.offset += chunk.length;
  }

  private readChar(char: string, position: number) {
    const token = this.token;
    switch (token.kind) {
      case "string":
        this.readStringChar(token, char, position);
        return;
      case "number":
      case "literal": {
        const charSet = token.kind === "number" ? NUMBER_CHAR : LITERAL_CHAR;
        if (charSet.test(char)) {
          token.text += char;
          return;
        }
        // Any other character ends the token. Then read that character
        // in the normal way.
        this.finishBareToken(token, position);
        this.readStructuralChar(char, position);
        return;
      }
      case "none":
        this.readStructuralChar(char, position);
        return;
      default: {
        const unreachable: never = token;
        return unreachable;
      }
    }
  }

  private readStringChar(
    token: Extract<Token, { kind: "string" }>,
    char: string,
    position: number,
  ) {
    const escape = token.escape;
    switch (escape.kind) {
      case "none":
        if (char === '"') {
          this.finishString(token);
          return;
        }
        if (char === "\\") {
          token.escape = { kind: "backslash" };
          return;
        }
        token.text += char;
        return;
      case "backslash": {
        if (char === "u") {
          token.escape = { kind: "unicode", hex: "" };
          return;
        }
        token.escape = NO_ESCAPE;
        const decoded = SIMPLE_ESCAPES[char];
        if (decoded === undefined) {
          this.warn(`bad escape "\\${char}"`, position);
          return;
        }
        token.text += decoded;
        return;
      }
      case "unicode": {
        if (!HEX_DIGIT.test(char)) {
          // Drop the broken escape, then read this character as normal
          // string text (it can be the closing quote).
          this.warn(`bad \\u escape character "${char}"`, position);
          token.escape = NO_ESCAPE;
          this.readStringChar(token, char, position);
          return;
        }
        const hex = escape.hex + char;
        if (hex.length < 4) {
          token.escape = { kind: "unicode", hex };
          return;
        }
        // Append the UTF-16 code unit. Two `\u` escapes in a row then
        // form a correct surrogate pair.
        token.text += String.fromCharCode(parseInt(hex, 16));
        token.escape = NO_ESCAPE;
        return;
      }
      default: {
        const unreachable: never = escape;
        return unreachable;
      }
    }
  }

  private readStructuralChar(char: string, position: number) {
    if (WHITESPACE.test(char)) return;

    switch (this.expect) {
      case "value":
      case "valueOrClose":
        this.readValueStart(char, position);
        return;
      case "key":
      case "keyOrClose":
        if (char === '"') {
          this.token = {
            kind: "string",
            isKey: true,
            text: "",
            escape: NO_ESCAPE,
          };
          return;
        }
        if (char === "}" && this.expect === "keyOrClose") {
          this.closeContainer("object");
          return;
        }
        this.warn(`unexpected "${char}" where a key was expected`, position);
        return;
      case "colon":
        if (char === ":") {
          this.expect = "value";
          return;
        }
        this.warn(`unexpected "${char}" where ":" was expected`, position);
        return;
      case "commaOrClose":
        this.readAfterValue(char, position);
        return;
      default: {
        const unreachable: never = this.expect;
        return unreachable;
      }
    }
  }

  private readValueStart(char: string, position: number) {
    if (char === "{") {
      this.stack.push("object");
      this.expect = "keyOrClose";
      this.handlers.onOpenObject?.();
      return;
    }
    if (char === "[") {
      this.stack.push("array");
      this.expect = "valueOrClose";
      this.handlers.onOpenArray?.();
      return;
    }
    if (char === '"') {
      this.token = {
        kind: "string",
        isKey: false,
        text: "",
        escape: NO_ESCAPE,
      };
      return;
    }
    if (NUMBER_START.test(char)) {
      this.token = { kind: "number", text: char };
      return;
    }
    if (char === "t" || char === "f" || char === "n") {
      this.token = { kind: "literal", text: char };
      return;
    }
    if (char === "]" && this.expect === "valueOrClose") {
      this.closeContainer("array");
      return;
    }
    this.warn(`unexpected "${char}" where a value was expected`, position);
  }

  private readAfterValue(char: string, position: number) {
    const top = this.stack[this.stack.length - 1];
    if (char === ",") {
      this.expect = top === "object" ? "key" : "value";
      return;
    }
    if (char === "}" && top === "object") {
      this.closeContainer("object");
      return;
    }
    if (char === "]" && top === "array") {
      this.closeContainer("array");
      return;
    }
    this.warn(`unexpected "${char}" after a value`, position);
  }

  private closeContainer(container: Container) {
    this.stack.pop();
    if (container === "object") {
      this.handlers.onCloseObject?.();
    } else {
      this.handlers.onCloseArray?.();
    }
    this.afterValue();
  }

  private finishString(token: Extract<Token, { kind: "string" }>) {
    this.token = NO_TOKEN;
    if (token.isKey) {
      this.expect = "colon";
      this.handlers.onKey?.(token.text);
      return;
    }
    this.afterValue();
    this.handlers.onValue?.(token.text);
  }

  private finishBareToken(
    token: Extract<Token, { kind: "number" | "literal" }>,
    position: number,
  ) {
    this.token = NO_TOKEN;
    // A bad token counts as a value that is dropped. The scanner then
    // expects "," or a close, so the next key or value still arrives.
    this.afterValue();
    const value = parseBareToken(token);
    if (value === undefined) {
      this.warn(`bad ${token.kind} "${token.text}"`, position);
      return;
    }
    this.handlers.onValue?.(value);
  }

  private afterValue() {
    this.expect = this.stack.length === 0 ? "value" : "commaOrClose";
  }

  private warn(problem: string, position: number) {
    if (this.hasWarned) return;
    this.hasWarned = true;
    this.onWarn(
      `JSON parse error in streaming args at position ${position}: ${problem}. Skipping it and continuing.`,
    );
  }
}

/** Index of the first `"` or `\` at or after `start`, or the chunk length. */
function findStringRunEnd(chunk: string, start: number) {
  for (let index = start; index < chunk.length; index++) {
    const char = chunk[index];
    if (char === '"' || char === "\\") return index;
  }
  return chunk.length;
}

/** The value of a number or literal token, or undefined when it is not valid JSON. */
function parseBareToken(token: Extract<Token, { kind: "number" | "literal" }>) {
  if (token.kind === "number") {
    return JSON_NUMBER.test(token.text) ? Number(token.text) : undefined;
  }
  return Object.hasOwn(LITERALS, token.text) ? LITERALS[token.text] : undefined;
}
