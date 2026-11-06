import { describe, expect, it } from "vitest";
import { Utf8TextDecoder, Utf8TextEncoder } from "../utf8";

// Node's built-in classes are the reference: the polyfill must give the same
// output on the runtimes that lack them.
const NativeEncoder = globalThis.TextEncoder;
const NativeDecoder = globalThis.TextDecoder;

const strings = [
  "",
  "hello",
  "Grüße, 東京, emoji 🚀🧪",
  "\u0000\u007f\u0080߿ࠀ￿",
  "🚀 pair, \ud800 lone high, \udc00 lone low",
  "﻿starts with a BOM",
];

const byteSequences: number[][] = [
  [0xe2, 0x82, 0xac],
  [0xc3],
  [0xc0, 0x80],
  [0xed, 0xa0, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf0, 0x9f, 0x9a],
  [0xe0, 0x80, 0x41],
  [0x80, 0xbf, 0x41],
  [0xff, 0xfe, 0x41],
  [0xef, 0xbb, 0xbf, 0x41],
  [0xf0, 0x9f, 0x98, 0x80, 0xe2, 0x82],
];

function splits(bytes: Uint8Array): Uint8Array[][] {
  const out: Uint8Array[][] = [[bytes]];
  for (let at = 0; at <= bytes.length; at++) {
    out.push([bytes.subarray(0, at), bytes.subarray(at)]);
  }
  out.push([...bytes].map((byte) => new Uint8Array([byte])));
  return out;
}

function streamDecode(
  decoder: {
    decode: (input?: Uint8Array, options?: { stream?: boolean }) => string;
  },
  chunks: Uint8Array[],
): string {
  return (
    chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
    decoder.decode()
  );
}

describe("Utf8TextEncoder", () => {
  it.each(strings)("encodes %j like the built-in encoder", (input) => {
    expect([...new Utf8TextEncoder().encode(input)]).toEqual([
      ...new NativeEncoder().encode(input),
    ]);
  });
});

describe("Utf8TextDecoder", () => {
  const inputs = [
    ...strings.map((input) => new NativeEncoder().encode(input)),
    ...byteSequences.map((bytes) => new Uint8Array(bytes)),
  ];

  it.each(inputs.map((bytes) => [[...bytes].join(","), bytes] as const))(
    "decodes [%s] like the built-in decoder, in every chunk split",
    (_, bytes) => {
      for (const chunks of splits(bytes)) {
        for (const ignoreBOM of [false, true]) {
          expect(
            streamDecode(new Utf8TextDecoder("utf-8", { ignoreBOM }), chunks),
          ).toBe(
            streamDecode(new NativeDecoder("utf-8", { ignoreBOM }), chunks),
          );
        }
      }
    },
  );

  it("throws on invalid bytes when fatal is set", () => {
    for (const bytes of byteSequences.map((b) => new Uint8Array(b))) {
      const native = () =>
        new NativeDecoder("utf-8", { fatal: true }).decode(bytes);
      const polyfill = () =>
        new Utf8TextDecoder("utf-8", { fatal: true }).decode(bytes);
      let nativeThrew = false;
      try {
        native();
      } catch {
        nativeThrew = true;
      }
      if (nativeThrew) expect(polyfill).toThrow(TypeError);
      else expect(polyfill()).toBe(native());
    }
  });

  it("decodes an ArrayBuffer and a view into a larger buffer", () => {
    const buffer = new NativeEncoder().encode("xx東京xx").buffer;
    expect(new Utf8TextDecoder().decode(buffer)).toBe("xx東京xx");
    expect(new Utf8TextDecoder().decode(new Uint8Array(buffer, 2, 6))).toBe(
      "東京",
    );
    expect(new Utf8TextDecoder().decode()).toBe("");
  });

  it("supports only UTF-8", () => {
    expect(new Utf8TextDecoder("UTF8").encoding).toBe("utf-8");
    expect(() => new Utf8TextDecoder("latin1")).toThrow(RangeError);
  });
});
