import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { attachSseInterceptor } from "./sse-interceptor.js";
import type { Page } from "playwright";

// Exercise the actual injected fetch tee with real Web Streams; CDP's final
// response body cannot distinguish progressively delivered events.
describe("browser structural SSE arrival evidence", () => {
  it("captures distinct arrival batches without consuming the application stream", async () => {
    const scripts: string[] = [];
    const cdp = {
      send: async () => ({}),
      on() {},
      off() {},
      detach: async () => {},
    };
    const page = {
      addInitScript: async (script: string) => {
        scripts.push(script);
      },
      context: () => ({ newCDPSession: async () => cdp }),
      on() {},
      off() {},
      mainFrame() {},
    } as unknown as Page;
    const handle = await attachSseInterceptor(page);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    );
    const sandbox = {
      fetch: async (_url?: string) => response,
      TextDecoder,
      performance,
      __hk_a2uiProbe: { events: [], batch: 0 },
    };
    vm.runInNewContext(scripts[0]!, sandbox);
    const application = await sandbox.fetch("http://localhost/api/copilotkit");
    const encoder = new TextEncoder();
    const event = (type: string, extra = {}) =>
      `data: ${JSON.stringify({ type, ...extra })}\n\n`;
    controller.enqueue(
      encoder.encode(
        event("ACTIVITY_SNAPSHOT", {
          messageId: "a2ui-surface-1",
          activityType: "a2ui-surface",
          content: { inferenceFormat: "express", a2ui_operations: [{ a: 1 }] },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.enqueue(
      encoder.encode(
        event("ACTIVITY_SNAPSHOT", {
          messageId: "a2ui-surface-1",
          activityType: "a2ui-surface",
          content: {
            inferenceFormat: "express",
            a2ui_operations: [{ a: 1 }, { b: 2 }],
          },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.enqueue(encoder.encode(event("RUN_FINISHED")));
    controller.close();
    const body = await application.text();
    await new Promise((r) => setTimeout(r, 10));
    const records = sandbox.__hk_a2uiProbe.events as Array<{
      batch: number;
      at: number;
      payload: { type: string };
    }>;
    expect(records.map((r) => r.payload.type)).toEqual([
      "ACTIVITY_SNAPSHOT",
      "ACTIVITY_SNAPSHOT",
      "RUN_FINISHED",
    ]);
    expect(records[0]!.batch).toBeLessThan(records[1]!.batch);
    expect(records[0]!.at).toBeLessThan(records[1]!.at);
    expect(body).toContain("RUN_FINISHED");
    await handle.stop();
  });
});

import { assertA2uiEvidence, withA2uiFormat } from "./a2ui-format.js";
import type { A2uiEvidence } from "./a2ui-format.js";

function progressive(): A2uiEvidence {
  return {
    newSurfaceCount: 1,
    events: [
      {
        at: 1,
        batch: 1,
        payload: {
          type: "TOOL_CALL_START",
          toolCallName: "generate_a2ui",
          toolCallId: "outer",
        },
      },
      // AG-UI TOOL_CALL_END means arguments completed, before tool execution.
      {
        at: 2,
        batch: 1,
        payload: { type: "TOOL_CALL_END", toolCallId: "outer" },
      },
      ...[10, 20].map((at, i) => ({
        at,
        batch: i + 2,
        payload: {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "a2ui-surface-outer",
          activityType: "a2ui-surface",
          content: {
            inferenceFormat: "express",
            a2ui_operations: [
              {
                createSurface: {
                  surfaceId: "one-surface",
                  catalogId: "catalog",
                },
              },
              {
                updateComponents: {
                  surfaceId: "one-surface",
                  components: [
                    {
                      id: "root",
                      component: "Column",
                      children: i ? ["m1", "m2"] : ["m1"],
                    },
                    {
                      id: "m1",
                      component: "Metric",
                      label: "Revenue",
                      value: "$4.2M",
                    },
                    ...(i
                      ? [
                          {
                            id: "m2",
                            component: "Metric",
                            label: "Win Rate",
                            value: "31%",
                          },
                        ]
                      : []),
                  ],
                },
              },
              {
                updateDataModel: {
                  surfaceId: "one-surface",
                  path: "/",
                  value: { summary: i ? "Revenue and win rate" : "Revenue" },
                },
              },
            ],
          },
        },
      })),
      {
        at: 30,
        batch: 4,
        payload: {
          type: "TOOL_CALL_RESULT",
          toolCallId: "outer",
          content: "{}",
        },
      },
      { at: 40, batch: 5, payload: { type: "RUN_FINISHED" } },
    ],
    paints: [
      { at: 11, signature: "first metric", count: 1 },
      { at: 21, signature: "first metric|second metric", count: 2 },
    ],
  };
}

function surfaceSnapshots(evidence: A2uiEvidence) {
  return evidence.events.filter(
    (event) =>
      event.payload.type === "ACTIVITY_SNAPSHOT" &&
      event.payload.content?.a2ui_operations,
  );
}

describe("A2UI format contract", () => {
  it("accepts replacing three-operation current-state snapshots with distinct content and DOM updates before tool completion", () => {
    expect(() =>
      assertA2uiEvidence(progressive(), "express", "stream"),
    ).not.toThrow();
  });
  it.each([
    "duplicate",
    "same-batch",
    "after-result",
    "wrong-id",
    "no-dom-update",
  ])("rejects %s masquerading as progressive rendering", (defect) => {
    const e = progressive();
    if (defect === "duplicate")
      surfaceSnapshots(e)[1]!.payload.content =
        surfaceSnapshots(e)[0]!.payload.content;
    if (defect === "same-batch")
      surfaceSnapshots(e)[1]!.batch = surfaceSnapshots(e)[0]!.batch;
    if (defect === "after-result") surfaceSnapshots(e)[1]!.at = 31;
    if (defect === "wrong-id")
      surfaceSnapshots(e)[1]!.payload.messageId = "a2ui-surface-other";
    if (defect === "no-dom-update")
      e.paints[1]!.signature = e.paints[0]!.signature;
    expect(() => assertA2uiEvidence(e, "express", "stream")).toThrow(
      /a2ui-format:/,
    );
  });
  it("rejects final JSON rendering as evidence of Express", () => {
    const e = progressive();
    e.events = e.events.filter(
      (item) => item.payload.type !== "ACTIVITY_SNAPSHOT",
    );
    expect(() => assertA2uiEvidence(e, "express", "stream")).toThrow(
      /no server surface/,
    );
  });
  it("checks fixed SDK output instead of relying on a selector label", () => {
    const e: A2uiEvidence = {
      newSurfaceCount: 1,
      paints: [],
      events: [
        {
          at: 1,
          batch: 1,
          payload: {
            type: "TOOL_CALL_RESULT",
            content: JSON.stringify({ inferenceFormat: "direct_json" }),
          },
        },
        { at: 2, batch: 2, payload: { type: "RUN_FINISHED" } },
      ],
    };
    expect(() => assertA2uiEvidence(e, "express", "fixed")).toThrow(
      /fixed SDK result/,
    );
    expect(() => assertA2uiEvidence(e, "direct_json", "fixed")).not.toThrow();
  });
  it("rejects exhausted attempts that transiently painted", () => {
    const e: A2uiEvidence = {
      newSurfaceCount: 0,
      paints: [{ at: 1, signature: "invalid", count: 1 }],
      events: [
        {
          at: 2,
          batch: 1,
          payload: {
            type: "TOOL_CALL_RESULT",
            content: JSON.stringify({ code: "a2ui_recovery_exhausted" }),
          },
        },
        { at: 3, batch: 2, payload: { type: "RUN_FINISHED" } },
      ],
    };
    expect(() => assertA2uiEvidence(e, "express", "exhaust")).toThrow(
      /painted/,
    );
  });
  it("preserves the default URL and existing query parameters", () => {
    expect(withA2uiFormat("http://localhost/demos/a2ui")).toBe(
      "http://localhost/demos/a2ui",
    );
    expect(withA2uiFormat("http://localhost/demos/a2ui?x=1", "express")).toBe(
      "http://localhost/demos/a2ui?x=1&format=express",
    );
  });
});

it("accepts Direct JSON only from the actual structured inner tool arguments", () => {
  const evidence: A2uiEvidence = {
    newSurfaceCount: 1,
    paints: [],
    events: [
      {
        at: 1,
        batch: 1,
        payload: {
          type: "TOOL_CALL_START",
          toolCallName: "render_a2ui",
          toolCallId: "inner",
        },
      },
      {
        at: 2,
        batch: 2,
        payload: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "inner",
          delta: '{"components":',
        },
      },
      {
        at: 3,
        batch: 3,
        payload: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "inner",
          delta: '[{"id":"root"}]}',
        },
      },
      { at: 4, batch: 4, payload: { type: "RUN_FINISHED" } },
    ],
  };
  expect(() =>
    assertA2uiEvidence(evidence, "direct_json", "stream"),
  ).not.toThrow();
  evidence.events[2]!.payload.toolCallId = "previous-run";
  expect(() => assertA2uiEvidence(evidence, "direct_json", "stream")).toThrow(
    /missing structured/,
  );
});

it("requires one final surface even when progressive events are valid", () => {
  const e = progressive();
  e.newSurfaceCount = 2;
  expect(() => assertA2uiEvidence(e, "express", "stream")).toThrow(
    /expected 1 new final surface/,
  );
});

it("requires a rejected first recovery attempt before any painted surface", () => {
  const e = progressive();
  expect(() => assertA2uiEvidence(e, "express", "heal")).toThrow(
    /rejected first attempt/,
  );
  e.events.splice(2, 0, {
    at: 5,
    batch: 1,
    payload: {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "a2ui-surface",
      messageId: "a2ui-surface-outer",
      content: {
        inferenceFormat: "express",
        status: "retrying",
        errors: [{ code: "invalid" }],
      },
    },
  });
  expect(() => assertA2uiEvidence(e, "express", "heal")).not.toThrow();
  e.paints.unshift({ at: 3, signature: "invalid first draft", count: 1 });
  expect(() => assertA2uiEvidence(e, "express", "heal")).toThrow(
    /before retry/,
  );
});

it("counts changed component data as progress even when component and operation counts are unchanged", () => {
  const e = progressive();
  surfaceSnapshots(e)[1]!.payload.content.a2ui_operations = structuredClone(
    surfaceSnapshots(e)[0]!.payload.content.a2ui_operations,
  );
  surfaceSnapshots(
    e,
  )[1]!.payload.content.a2ui_operations[2].updateDataModel.value.summary =
    "Final revenue summary";
  e.paints[1] = { at: 21, signature: "Final revenue summary", count: 1 };
  expect(() => assertA2uiEvidence(e, "express", "stream")).not.toThrow();
});

it("ignores object key ordering as evidence of structural progress", () => {
  const e = progressive();
  const reorder = (value: any): any => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .toReversed()
          .map((key) => [key, reorder(value[key])]),
      );
    return value;
  };
  surfaceSnapshots(e)[1]!.payload.content.a2ui_operations = reorder(
    surfaceSnapshots(e)[0]!.payload.content.a2ui_operations,
  );
  expect(() => assertA2uiEvidence(e, "express", "stream")).toThrow(
    /no distinct current-state/,
  );
});

it("allows the middleware's final surface snapshot after a fixed template result", () => {
  const evidence: A2uiEvidence = {
    newSurfaceCount: 1,
    paints: [{ at: 4, signature: "flight card", count: 1 }],
    events: [
      {
        at: 1,
        batch: 1,
        payload: {
          type: "TOOL_CALL_START",
          toolCallName: "display_flight",
          toolCallId: "fixed",
        },
      },
      {
        at: 2,
        batch: 2,
        payload: {
          type: "TOOL_CALL_RESULT",
          toolCallId: "fixed",
          content: JSON.stringify({
            inferenceFormat: "express",
            a2ui_operations: [{ createSurface: {} }],
          }),
        },
      },
      {
        at: 2,
        batch: 2,
        payload: {
          type: "ACTIVITY_SNAPSHOT",
          activityType: "a2ui-surface",
          messageId: "a2ui-surface-fixed",
          content: { a2ui_operations: [{ createSurface: {} }] },
        },
      },
      { at: 5, batch: 3, payload: { type: "RUN_FINISHED" } },
    ],
  };
  expect(() => assertA2uiEvidence(evidence, "express", "fixed")).not.toThrow();
  evidence.events.unshift({
    at: 0,
    batch: 0,
    payload: {
      type: "TOOL_CALL_START",
      toolCallName: "generate_a2ui",
      toolCallId: "unexpected-generation",
    },
  });
  expect(() => assertA2uiEvidence(evidence, "express", "fixed")).toThrow(
    /unexpectedly invoked model generation/,
  );
});
