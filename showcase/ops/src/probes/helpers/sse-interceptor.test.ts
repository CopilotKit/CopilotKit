import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assembleCapture,
  collectContractShape,
  computeStreamProfile,
  extractToolCallNames,
  parseSseEvents,
} from "./sse-interceptor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../../test/fixtures/sse-samples",
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, name), "utf-8");
}

describe("parseSseEvents", () => {
  it("returns empty list for empty payload", () => {
    expect(parseSseEvents("")).toEqual([]);
  });

  it("parses an empty stream (RUN_STARTED + RUN_FINISHED only)", async () => {
    const payload = await loadFixture("empty-stream.txt");
    const events = parseSseEvents(payload);
    const types = events
      .filter((e) => e.kind === "json")
      .map((e) => (e.kind === "json" ? e.payload["type"] : null));
    expect(types).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  it("parses a single-tool-call stream", async () => {
    const payload = await loadFixture("single-tool-call.txt");
    const events = parseSseEvents(payload);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.kind === "json")).toBe(true);
  });

  it("concatenates multi-line data records per the SSE spec", async () => {
    const payload = await loadFixture("multiline-data.txt");
    const events = parseSseEvents(payload);
    // First record uses three `data:` continuation lines that join into a
    // single JSON object — must NOT split into three malformed records.
    const firstJson = events.find((e) => e.kind === "json");
    expect(firstJson).toBeDefined();
    if (firstJson?.kind === "json") {
      expect(firstJson.payload["type"]).toBe("RUN_STARTED");
      expect(firstJson.payload["threadId"]).toBe("t-3");
    }
  });

  it("recovers from a malformed (half-line) chunk without throwing", () => {
    // Producer sent a half-line followed by the next valid record; per
    // SSE the malformed record terminates at \n\n and we should mark it
    // non-json rather than throwing.
    const payload =
      'data: {"type":"BROKEN","unterminated\n\n' +
      'data: {"type":"RUN_FINISHED"}\n\n';
    const events = parseSseEvents(payload);
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe("non-json");
    expect(events[1]!.kind).toBe("json");
    if (events[1]!.kind === "json") {
      expect(events[1]!.payload["type"]).toBe("RUN_FINISHED");
    }
  });

  it("ignores SSE comment lines", () => {
    const payload =
      ': keep-alive\n' +
      'data: {"type":"RUN_STARTED"}\n\n';
    const events = parseSseEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("json");
  });

  it("normalizes CRLF line endings", () => {
    const payload =
      'data: {"type":"A"}\r\n\r\n' + 'data: {"type":"B"}\r\n\r\n';
    const events = parseSseEvents(payload);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === "json")).toBe(true);
  });

  it("strips a single leading space after data:", () => {
    const payloadWithSpace = 'data: {"type":"X"}\n\n';
    const payloadWithoutSpace = 'data:{"type":"X"}\n\n';
    const a = parseSseEvents(payloadWithSpace);
    const b = parseSseEvents(payloadWithoutSpace);
    expect(a).toEqual(b);
  });
});

describe("extractToolCallNames", () => {
  it("returns empty list when no tool-call events present", async () => {
    const payload = await loadFixture("empty-stream.txt");
    const events = parseSseEvents(payload);
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([]);
  });

  it("returns a single name from the single-tool-call fixture", async () => {
    const payload = await loadFixture("single-tool-call.txt");
    const events = parseSseEvents(payload);
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([
      "get_weather",
    ]);
  });

  it("returns names in arrival order for multi-tool-call", async () => {
    const payload = await loadFixture("multi-tool-call.txt");
    const events = parseSseEvents(payload);
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([
      "search_flights",
      "book_hotel",
      "send_confirmation",
    ]);
  });

  it("falls back to .name when toolCallName is absent", () => {
    const events = parseSseEvents(
      'data: {"type":"TOOL_CALL_START","name":"legacy_tool"}\n\n',
    );
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([
      "legacy_tool",
    ]);
  });

  it("falls back to tool_call.name (snake_case)", () => {
    const events = parseSseEvents(
      'data: {"type":"TOOL_CALL_START","tool_call":{"name":"sc_tool"}}\n\n',
    );
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([
      "sc_tool",
    ]);
  });

  it("falls back to tool_use.name (Anthropic-style)", () => {
    const events = parseSseEvents(
      'data: {"type":"TOOL_CALL_START","tool_use":{"name":"anth_tool"}}\n\n',
    );
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([
      "anth_tool",
    ]);
  });

  it("ignores events with non-matching type", () => {
    const events = parseSseEvents(
      'data: {"type":"OTHER_EVENT","toolCallName":"ignored"}\n\n',
    );
    expect(extractToolCallNames(events, ["TOOL_CALL_START"])).toEqual([]);
  });

  it("supports custom event-type lists", () => {
    const events = parseSseEvents(
      'data: {"type":"CUSTOM_TOOL_BEGIN","name":"x"}\n\n',
    );
    expect(extractToolCallNames(events, ["CUSTOM_TOOL_BEGIN"])).toEqual(["x"]);
  });
});

describe("collectContractShape", () => {
  it("captures primitive types at the root", () => {
    const out: Record<string, string> = {};
    collectContractShape({ a: "x", b: 1, c: true, d: null }, "", out);
    expect(out["a"]).toBe("string");
    expect(out["b"]).toBe("number");
    expect(out["c"]).toBe("boolean");
    expect(out["d"]).toBe("null");
  });

  it("captures nested object paths", () => {
    const out: Record<string, string> = {};
    collectContractShape({ outer: { inner: "y" } }, "", out);
    expect(out["outer"]).toBe("object");
    expect(out["outer.inner"]).toBe("string");
  });

  it("captures arrays with [] notation", () => {
    const out: Record<string, string> = {};
    collectContractShape({ items: [{ name: "a" }, { name: "b" }] }, "", out);
    expect(out["items"]).toBe("array");
    expect(out["items[]"]).toBe("object");
    expect(out["items[].name"]).toBe("string");
  });

  it("does not record an 'object' key for the root path", () => {
    const out: Record<string, string> = {};
    collectContractShape({ a: 1 }, "", out);
    expect(out[""]).toBeUndefined();
  });
});

describe("computeStreamProfile", () => {
  it("returns all-zeros for an empty timestamp list", () => {
    const p = computeStreamProfile([], 0);
    expect(p).toEqual({
      ttft_ms: 0,
      inter_chunk_ms: [],
      p50_chunk_ms: 0,
      total_chunks: 0,
      duration_ms: 0,
    });
  });

  it("computes TTFT and duration for a single chunk", () => {
    const p = computeStreamProfile([100], 50);
    expect(p.ttft_ms).toBe(50);
    expect(p.duration_ms).toBe(50);
    expect(p.total_chunks).toBe(1);
    expect(p.inter_chunk_ms).toEqual([]);
    expect(p.p50_chunk_ms).toBe(0);
  });

  it("computes inter-chunk gaps and median for multiple chunks", () => {
    const p = computeStreamProfile([100, 150, 250, 300], 90);
    expect(p.ttft_ms).toBe(10);
    expect(p.duration_ms).toBe(210);
    expect(p.total_chunks).toBe(4);
    expect(p.inter_chunk_ms).toEqual([50, 100, 50]);
    expect(p.p50_chunk_ms).toBe(50);
  });

  it("clamps TTFT to >= 0 if request-start is after first chunk", () => {
    const p = computeStreamProfile([100], 200);
    expect(p.ttft_ms).toBe(0);
  });

  it("computes median correctly for an even-length list", () => {
    const p = computeStreamProfile([0, 10, 30, 60], 0);
    // gaps = [10, 20, 30], median (odd) = 20
    expect(p.p50_chunk_ms).toBe(20);
  });
});

describe("assembleCapture", () => {
  it("assembles a complete capture from the multi-tool-call fixture", async () => {
    const payload = await loadFixture("multi-tool-call.txt");
    const cap = assembleCapture(
      payload,
      [100, 110, 130, 200],
      90,
      ["TOOL_CALL_START"],
    );
    expect(cap.toolCalls).toEqual([
      "search_flights",
      "book_hotel",
      "send_confirmation",
    ]);
    expect(cap.streamProfile.total_chunks).toBe(4);
    expect(cap.streamProfile.ttft_ms).toBe(10);
    expect(cap.raw_event_count).toBeGreaterThan(0);
    // Tool-call events expose toolCallName as a string.
    expect(cap.contractFields["toolCallName"]).toBe("string");
    expect(cap.contractFields["type"]).toBe("string");
  });

  it("returns empty capture from empty payload", () => {
    const cap = assembleCapture("", [], 0, ["TOOL_CALL_START"]);
    expect(cap.toolCalls).toEqual([]);
    expect(cap.raw_event_count).toBe(0);
    expect(cap.streamProfile.total_chunks).toBe(0);
    expect(cap.contractFields).toEqual({});
  });

  it("counts only successfully parsed JSON records as events", () => {
    const payload =
      'data: {"type":"A"}\n\n' + 'data: not-json\n\n' + 'data: {"type":"B"}\n\n';
    const cap = assembleCapture(payload, [], 0, ["TOOL_CALL_START"]);
    expect(cap.raw_event_count).toBe(2);
  });
});
