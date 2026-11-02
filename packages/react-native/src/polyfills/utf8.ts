/**
 * UTF-8 `TextEncoder` and `TextDecoder`, for runtimes that have neither.
 *
 * CopilotKit only reads and writes UTF-8, so these classes support only that
 * encoding. The decoder follows the WHATWG UTF-8 decode algorithm, so its
 * output, including U+FFFD for invalid bytes and `{ stream: true }` chunks,
 * matches the built-in `TextDecoder`.
 */

const REPLACEMENT = 0xfffd;

export class Utf8TextEncoder {
  readonly encoding = "utf-8";

  encode(input = ""): Uint8Array {
    const bytes: number[] = [];
    for (const char of input) {
      let codePoint = char.codePointAt(0)!;
      // A lone surrogate is not a Unicode scalar value.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = REPLACEMENT;
      if (codePoint < 0x80) bytes.push(codePoint);
      else if (codePoint < 0x800)
        bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      else if (codePoint < 0x10000)
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      else
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
    }
    return new Uint8Array(bytes);
  }
}

export class Utf8TextDecoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  #codePoint = 0;
  #bytesNeeded = 0;
  #bytesSeen = 0;
  #lowerBoundary = 0x80;
  #upperBoundary = 0xbf;
  #atStart = true;

  constructor(
    label = "utf-8",
    options: { fatal?: boolean; ignoreBOM?: boolean } = {},
  ) {
    const normalized = String(label).trim().toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8") {
      throw new RangeError(`The "${label}" encoding is not supported.`);
    }
    this.fatal = options.fatal ?? false;
    this.ignoreBOM = options.ignoreBOM ?? false;
  }

  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options: { stream?: boolean } = {},
  ): string {
    const bytes =
      input === undefined
        ? new Uint8Array(0)
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);
    const codePoints: number[] = [];

    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (this.#bytesNeeded === 0) {
        if (byte <= 0x7f) codePoints.push(byte);
        else if (byte >= 0xc2 && byte <= 0xdf) this.#start(1, byte & 0x1f);
        else if (byte >= 0xe0 && byte <= 0xef) {
          if (byte === 0xe0) this.#lowerBoundary = 0xa0;
          if (byte === 0xed) this.#upperBoundary = 0x9f;
          this.#start(2, byte & 0x0f);
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          if (byte === 0xf0) this.#lowerBoundary = 0x90;
          if (byte === 0xf4) this.#upperBoundary = 0x8f;
          this.#start(3, byte & 0x07);
        } else codePoints.push(this.#error());
        continue;
      }
      if (byte < this.#lowerBoundary || byte > this.#upperBoundary) {
        // The sequence ends early. Read this byte again as a new sequence.
        this.#reset();
        codePoints.push(this.#error());
        i--;
        continue;
      }
      this.#lowerBoundary = 0x80;
      this.#upperBoundary = 0xbf;
      this.#codePoint = (this.#codePoint << 6) | (byte & 0x3f);
      if (++this.#bytesSeen === this.#bytesNeeded) {
        codePoints.push(this.#codePoint);
        this.#reset();
      }
    }

    if (!options.stream && this.#bytesNeeded > 0) {
      this.#reset();
      codePoints.push(this.#error());
    }
    if (this.#atStart && codePoints.length > 0) {
      this.#atStart = false;
      if (!this.ignoreBOM && codePoints[0] === 0xfeff) codePoints.shift();
    }
    if (!options.stream) this.#atStart = true;
    return codePointsToString(codePoints);
  }

  #start(bytesNeeded: number, codePoint: number): void {
    this.#bytesNeeded = bytesNeeded;
    this.#codePoint = codePoint;
  }

  #reset(): void {
    this.#codePoint = 0;
    this.#bytesNeeded = 0;
    this.#bytesSeen = 0;
    this.#lowerBoundary = 0x80;
    this.#upperBoundary = 0xbf;
  }

  #error(): number {
    if (this.fatal) {
      this.#atStart = true;
      throw new TypeError("The encoded data was not valid utf-8.");
    }
    return REPLACEMENT;
  }
}

function codePointsToString(codePoints: number[]): string {
  let out = "";
  // Stay under the engine's limit on function arguments.
  for (let i = 0; i < codePoints.length; i += 0x8000) {
    out += String.fromCodePoint(...codePoints.slice(i, i + 0x8000));
  }
  return out;
}
