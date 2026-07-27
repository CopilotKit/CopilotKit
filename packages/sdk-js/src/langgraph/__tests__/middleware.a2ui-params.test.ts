/**
 * Tests for the host `a2uiParams` override on the auto-injected generate_a2ui
 * tool (the design-guidelines parity gap).
 *
 * Before this, the auto-inject path hardwired getA2UITools to the toolkit
 * defaults: a host serving via copilotkitMiddleware could NOT override the
 * design/generation guidelines (e.g. to favor a repeating-card layout). The
 * `a2uiParams` option threads a host override through; the middleware still
 * injects the bound model and folds the registered catalog in (host wins).
 *
 * We mock @ag-ui/langgraph's getA2UITools to capture the params it is handed —
 * the real factory's bound guidelines are a closure the tool object never
 * exposes, so capture-at-the-boundary is the only way to assert what reached
 * the subagent. Isolated in its own file so the module-wide mock does not
 * affect the behavior tests in middleware.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { captured } = vi.hoisted(() => ({ captured: [] as any[] }));

vi.mock("@ag-ui/langgraph", () => ({
  getA2UITools: (params: any) => {
    captured.push(params);
    return { name: "generate_a2ui" };
  },
}));

// Imported AFTER vi.mock so the middleware binds the mocked getA2UITools.
import { createCopilotkitMiddleware } from "../middleware";

function makeRequest(overrides: any = {}): any {
  return {
    model: { _modelType: () => "fake" },
    messages: [],
    systemPrompt: undefined,
    tools: [],
    state: { messages: [] },
    runtime: {},
    ...overrides,
  };
}

async function runWrap(middleware: any, request: any) {
  const handler = async (_req: any) => ({ content: "ok" }) as any;
  await middleware.wrapModelCall(request, handler);
}

// Native path: schema present but non-JSON, so no catalogId / compositionGuide.
const NATIVE_STATE = {
  messages: [],
  thread_id: "native",
  "ag-ui": { a2ui_schema: "<components/>", inject_a2ui_tool: true },
};

// Runtime-proxy path: the catalog arrives as a context entry, so the middleware
// derives a compositionGuide + catalogId to fold in.
const CONTEXT_STATE = {
  messages: [],
  thread_id: "context",
  "ag-ui": { inject_a2ui_tool: true },
  copilotkit: {
    context: [
      {
        description: "A2UI catalog capabilities",
        value: "Available A2UI catalog:\n- my-custom-catalog\n  - Card: {...}",
      },
    ],
  },
};

describe("auto-A2UI host a2uiParams override", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("threads host guidelines through to getA2UITools (native path)", async () => {
    const middleware = createCopilotkitMiddleware({
      a2uiParams: { guidelines: { designGuidelines: "REPEAT_CARDS_MARK" } },
    });
    const request = makeRequest({ state: { ...NATIVE_STATE } });

    await runWrap(middleware, request);

    expect(captured).toHaveLength(1);
    const params = captured[0];
    // Host override survives...
    expect(params.guidelines.designGuidelines).toBe("REPEAT_CARDS_MARK");
    // ...the middleware still injects the bound model...
    expect(params.model).toBe(request.model);
    // ...and the native path contributes no compositionGuide.
    expect(params.guidelines.compositionGuide).toBeUndefined();
  });

  it("merges host guidelines with the registered catalog (context path)", async () => {
    const middleware = createCopilotkitMiddleware({
      a2uiParams: { guidelines: { designGuidelines: "REPEAT_CARDS_MARK" } },
    });

    await runWrap(middleware, makeRequest({ state: { ...CONTEXT_STATE } }));

    const params = captured[0];
    expect(params.guidelines.designGuidelines).toBe("REPEAT_CARDS_MARK");
    expect(params.guidelines.compositionGuide).toContain("my-custom-catalog");
    expect(params.defaultCatalogId).toBe("my-custom-catalog");
  });

  it("host compositionGuide + defaultCatalogId win over the catalog", async () => {
    const middleware = createCopilotkitMiddleware({
      a2uiParams: {
        defaultCatalogId: "host-catalog",
        guidelines: { compositionGuide: "HOST_COMP" },
      },
    });

    await runWrap(middleware, makeRequest({ state: { ...CONTEXT_STATE } }));

    const params = captured[0];
    expect(params.guidelines.compositionGuide).toBe("HOST_COMP");
    expect(params.defaultCatalogId).toBe("host-catalog");
  });

  it("default (no a2uiParams) carries only the inferred model", async () => {
    const middleware = createCopilotkitMiddleware();
    const request = makeRequest({ state: { ...NATIVE_STATE } });

    await runWrap(middleware, request);

    const params = captured[0];
    expect(params.model).toBe(request.model);
    expect(params.guidelines).toBeUndefined();
    expect(params.defaultCatalogId).toBeUndefined();
  });
});
