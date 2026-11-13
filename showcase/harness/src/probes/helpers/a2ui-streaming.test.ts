import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { attachSseInterceptor } from "./sse-interceptor.js";
import type { Page } from "playwright";
import type { Page as ConversationPage } from "./conversation-runner.js";

const sseEvent = (type: string, extra = {}) =>
  `data: ${JSON.stringify({ type, ...extra })}\n\n`;

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
    controller.enqueue(
      encoder.encode(
        sseEvent("ACTIVITY_SNAPSHOT", {
          messageId: "genui:surface-1",
          activityType: "generative-ui-surface",
          content: { operations: [{ a: 1 }] },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.enqueue(
      encoder.encode(
        sseEvent("ACTIVITY_SNAPSHOT", {
          messageId: "genui:surface-1",
          activityType: "generative-ui-surface",
          content: { operations: [{ a: 1 }, { b: 2 }] },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.enqueue(encoder.encode(sseEvent("RUN_FINISHED")));
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
          messageId: "genui:one-surface",
          activityType: "generative-ui-surface",
          content: {
            surfaceId: "one-surface",
            target: "chat",
            catalogId: "catalog",
            status: "ready",
            rejected: [],
            operations: [
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
      event.payload.content?.operations,
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
      surfaceSnapshots(e)[1]!.payload.messageId = "genui:other";
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
      /no generative-ui-surface/,
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
  it("requires the error surface of an exhausted recovery", () => {
    const e: A2uiEvidence = {
      newSurfaceCount: 0,
      paints: [],
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
      /missing error surface/,
    );
    e.events.splice(1, 0, {
      at: 2.5,
      batch: 1,
      payload: {
        type: "ACTIVITY_SNAPSHOT",
        activityType: "generative-ui-surface",
        messageId: "genui:a2ui-surface-outer",
        content: {
          surfaceId: "a2ui-surface-outer",
          target: "chat",
          catalogId: "copilotkit/standard@1",
          operations: [],
          status: "error",
          rejected: [{ index: 0, reason: "root is missing" }],
        },
      },
    });
    expect(() => assertA2uiEvidence(e, "express", "exhaust")).not.toThrow();
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

it("accepts a healed surface and rejects one that ended as an error surface", () => {
  const e = progressive();
  expect(() => assertA2uiEvidence(e, "express", "heal")).not.toThrow();
  e.events.splice(2, 0, {
    at: 5,
    batch: 1,
    payload: {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "generative-ui-surface",
      messageId: "genui:a2ui-surface-outer",
      content: {
        surfaceId: "a2ui-surface-outer",
        target: "chat",
        catalogId: "copilotkit/standard@1",
        operations: [],
        status: "error",
        rejected: [{ index: 0, reason: "invalid" }],
      },
    },
  });
  expect(() => assertA2uiEvidence(e, "express", "heal")).toThrow(
    /error surface/,
  );
});

it("counts changed component data as progress even when component and operation counts are unchanged", () => {
  const e = progressive();
  surfaceSnapshots(e)[1]!.payload.content.operations = structuredClone(
    surfaceSnapshots(e)[0]!.payload.content.operations,
  );
  surfaceSnapshots(
    e,
  )[1]!.payload.content.operations[2].updateDataModel.value.summary =
    "Final revenue summary";
  e.paints[1] = { at: 21, signature: "Final revenue summary", count: 1 };
  expect(() => assertA2uiEvidence(e, "express", "stream")).not.toThrow();
});

function reorder(value: any): any {
  if (Array.isArray(value)) return value.map(reorder);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      result[key] = reorder(value[key]);
    }
    return result;
  }
  return value;
}

it("ignores object key ordering as evidence of structural progress", () => {
  const e = progressive();
  surfaceSnapshots(e)[1]!.payload.content.operations = reorder(
    surfaceSnapshots(e)[0]!.payload.content.operations,
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
          activityType: "generative-ui-surface",
          messageId: "genui:fixed",
          content: { operations: [{ createSurface: {} }] },
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

it("retains tool lifecycles and run completion after the argument-event budget", async () => {
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
  const body =
    sseEvent("RUN_STARTED") +
    sseEvent("TOOL_CALL_START", {
      toolCallId: "g",
      toolCallName: "generate_a2ui",
    }) +
    Array.from({ length: 2100 }, () =>
      sseEvent("TOOL_CALL_ARGS", { toolCallId: "g", delta: "x" }),
    ).join("") +
    sseEvent("ACTIVITY_SNAPSHOT", {
      activityType: "generative-ui-surface",
      content: {},
    }) +
    sseEvent("TOOL_CALL_END", { toolCallId: "g" }) +
    sseEvent("TOOL_CALL_RESULT", { toolCallId: "g", content: "{}" }) +
    sseEvent("RUN_FINISHED");
  const sandbox = {
    fetch: async (_url?: string) => new Response(body),
    TextDecoder,
    performance,
    __hk_a2uiProbe: {
      events: [] as Array<{ payload: { type: string } }>,
      batch: 0,
    },
  };
  vm.runInNewContext(scripts[0]!, sandbox);
  const response = await sandbox.fetch("http://localhost/api/copilotkit");
  expect(await response.text()).toContain("RUN_FINISHED");
  await new Promise((r) => setTimeout(r, 30));
  const types = sandbox.__hk_a2uiProbe.events.map((e) => e.payload.type);
  expect(types.filter((type) => type === "TOOL_CALL_ARGS")).toHaveLength(2000);
  expect(types.slice(-4)).toEqual([
    "ACTIVITY_SNAPSHOT",
    "TOOL_CALL_END",
    "TOOL_CALL_RESULT",
    "RUN_FINISHED",
  ]);
  await handle.stop();
});

it("checks the HEAL turn for a progressive surface, also after reload", async () => {
  const { buildTurns } = await import("../scripts/d5-a2ui-recovery.js");
  let metrics = 0;
  let evidence = progressive();
  const page = {
    evaluate: async (fn: () => unknown) => {
      const body = fn.toString();
      if (body.includes("Part of this UI couldn't be shown."))
        return { metric: metrics, failure: 0 };
      if (body.includes("newSurfaceCount")) return evidence;
      return undefined;
    },
  } as unknown as ConversationPage;
  const turn = buildTurns({
    integrationSlug: "google-adk",
    featureType: "a2ui-recovery",
    baseUrl: "http://localhost",
    a2uiFormat: "express",
  })[0]!;
  await turn.preFill!(page);
  metrics = 2;
  await expect(
    turn.assertions!(page, { bubbleIndex: 0, text: "" }),
  ).resolves.toBeUndefined();
  // A heal that ended as an error surface fails.
  evidence = progressive();
  evidence.events.splice(2, 0, {
    at: 5,
    batch: 1,
    payload: {
      type: "ACTIVITY_SNAPSHOT",
      activityType: "generative-ui-surface",
      messageId: "genui:a2ui-surface-outer",
      content: { operations: [], status: "error", rejected: [{ index: 0 }] },
    },
  });
  await expect(
    turn.assertions!(page, { bubbleIndex: 0, text: "" }),
  ).rejects.toThrow("error surface");
  evidence = progressive();
  metrics = 0;
  await turn.afterReload?.(page);
  metrics = 2;
  await expect(
    turn.assertions!(page, { bubbleIndex: 0, text: "" }),
  ).resolves.toBeUndefined();
});
