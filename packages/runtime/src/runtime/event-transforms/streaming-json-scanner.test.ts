import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingJsonScanner } from "./streaming-json-scanner";
import type { JsonScalar } from "./streaming-json-scanner";

type RecordedEvent = [event: string, arg?: JsonScalar];

function createRecordingScanner() {
  const events: RecordedEvent[] = [];
  const onWarn = vi.fn();
  const scanner = new StreamingJsonScanner(
    {
      onOpenObject: () => events.push(["openObject"]),
      onKey: (key) => events.push(["key", key]),
      onValue: (value) => events.push(["value", value]),
      onOpenArray: () => events.push(["openArray"]),
      onCloseArray: () => events.push(["closeArray"]),
      onCloseObject: () => events.push(["closeObject"]),
    },
    onWarn,
  );
  return { events, onWarn, scanner };
}

function scanChunks(chunks: string[]) {
  const recording = createRecordingScanner();
  for (const chunk of chunks) {
    recording.scanner.write(chunk);
  }
  return recording;
}

function valuesOf(events: RecordedEvent[]) {
  return events.filter(([event]) => event === "value").map(([, arg]) => arg);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StreamingJsonScanner", () => {
  const sample = String.raw`{"initialHeight":300,"css":"a{b:c}","html":"<p>\"hi\" é 😀</p>","jsExpressions":["x","y"],"nested":{"k":[1,{"z":null}]},"ok":true}`;

  const sampleEvents: RecordedEvent[] = [
    ["openObject"],
    ["key", "initialHeight"],
    ["value", 300],
    ["key", "css"],
    ["value", "a{b:c}"],
    ["key", "html"],
    ["value", '<p>"hi" é 😀</p>'],
    ["key", "jsExpressions"],
    ["openArray"],
    ["value", "x"],
    ["value", "y"],
    ["closeArray"],
    ["key", "nested"],
    ["openObject"],
    ["key", "k"],
    ["openArray"],
    ["value", 1],
    ["openObject"],
    ["key", "z"],
    ["value", null],
    ["closeObject"],
    ["closeArray"],
    ["closeObject"],
    ["key", "ok"],
    ["value", true],
    ["closeObject"],
  ];

  it("gives the expected events when the sample comes in one chunk", () => {
    const { events, onWarn } = scanChunks([sample]);

    expect(events).toEqual(sampleEvents);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("gives the same events for every split point of the sample", () => {
    for (let splitAt = 0; splitAt <= sample.length; splitAt++) {
      const { events, onWarn } = scanChunks([
        sample.slice(0, splitAt),
        sample.slice(splitAt),
      ]);

      expect(events, `split at ${splitAt}`).toEqual(sampleEvents);
      expect(onWarn, `split at ${splitAt}`).not.toHaveBeenCalled();
    }
  });

  it("decodes every simple JSON escape", () => {
    const { events } = scanChunks([
      String.raw`{"s":"\" \\ \/ \b \f \n \r \t"}`,
    ]);

    expect(valuesOf(events)).toEqual(['" \\ / \b \f \n \r \t']);
  });

  it("streams partialString only while a string value is read", () => {
    const { scanner, events } = createRecordingScanner();

    scanner.write('{"htm');
    expect(scanner.partialString).toBeUndefined();

    scanner.write('l":"<di');
    expect(scanner.partialString).toBe("<di");

    scanner.write('v>"}');
    expect(events).toEqual([
      ["openObject"],
      ["key", "html"],
      ["value", "<div>"],
      ["closeObject"],
    ]);
    expect(scanner.partialString).toBeUndefined();
  });

  it.each([
    {
      name: "a \\u escape split after \\u0",
      chunks: [String.raw`{"html":"caf\u0`, String.raw`0e9!"}`],
      partialAfterFirst: "caf",
      value: "café!",
    },
    {
      name: "a surrogate pair split between its two \\u escapes",
      chunks: [String.raw`{"html":"a\uD83D`, String.raw`\uDE00b"}`],
      partialAfterFirst: "a",
      value: "a😀b",
    },
    {
      name: "a raw emoji split between its two code units",
      chunks: ['{"html":"a\uD83D', '\uDE00b"}'],
      partialAfterFirst: "a",
      value: "a😀b",
    },
  ])("decodes $name", ({ chunks, partialAfterFirst, value }) => {
    const { scanner, events } = createRecordingScanner();

    scanner.write(chunks[0]);
    expect(scanner.partialString).toBe(partialAfterFirst);

    scanner.write(chunks[1]);
    expect(valuesOf(events)).toEqual([value]);
  });

  it("fires a number value when } closes the object", () => {
    const { events } = scanChunks(['{"initialHeight":300}']);

    expect(events).toEqual([
      ["openObject"],
      ["key", "initialHeight"],
      ["value", 300],
      ["closeObject"],
    ]);
  });

  it("reads numbers and literals split across chunks", () => {
    const { events, onWarn } = scanChunks([
      '{"a":-1.',
      "5e",
      '2,"b":tr',
      'ue,"c":fal',
      'se,"d":nu',
      "ll",
      "}",
    ]);

    expect(valuesOf(events)).toEqual([-150, true, false, null]);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("skips bad characters, warns one time, and still gives later values", () => {
    const { events, onWarn } = scanChunks(['{"css":"a" x ,"html":"b" y }']);

    expect(events).toEqual([
      ["openObject"],
      ["key", "css"],
      ["value", "a"],
      ["key", "html"],
      ["value", "b"],
      ["closeObject"],
    ]);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it("drops a bad number or literal and continues with the next key", () => {
    const { events, onWarn } = scanChunks(['{"a":tru,"b":01,"c":2}']);

    expect(events).toEqual([
      ["openObject"],
      ["key", "a"],
      ["key", "b"],
      ["key", "c"],
      ["value", 2],
      ["closeObject"],
    ]);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it("warns with console.warn and the [OpenGenerativeUI] prefix by default", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scanner = new StreamingJsonScanner({});

    scanner.write('{"a" x : 1}');

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toMatch(/^\[OpenGenerativeUI\] /);
  });
});
