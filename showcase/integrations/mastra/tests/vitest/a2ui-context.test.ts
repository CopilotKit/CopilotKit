/**
 * Regression: on a LIVE endpoint the Beautiful Chat A2UI *dynamic* surface
 * (Sales Dashboard, flights) rendered no UI / a varying error, while aimock
 * passed.
 *
 * Root cause: the dynamic `generate_a2ui` tool grounded its inner `render_a2ui`
 * subagent from the tool's `contextEntries` ARG, which the outer model always
 * sends empty (captured live: `{"messages":[…],"contextEntries":[]}`). So the
 * inner render ran with an EMPTY system prompt — ungrounded, it emitted
 * invalid/misnamed components (or none) and the surface never resolved against
 * the catalog. aimock hid it: the recorded fixture returns a valid envelope
 * regardless of the empty context.
 *
 * Fix: read the catalog schema + generation guidelines the `@ag-ui/mastra`
 * bridge forwards onto Mastra's request context (`requestContext.get("ag-ui")
 * .context`) and ground the render there. These tests lock the read + assert
 * the resulting system prompt is actually grounded, mirroring the live shape.
 */
import { describe, it, expect } from "vitest";
import { generateA2uiImpl } from "@copilotkit/showcase-shared-tools";
import { readForwardedA2uiContext } from "@/mastra/tools/a2ui-context";

/** The context array the bridge forwards, captured live from staging. */
const forwardedContext = [
  {
    description:
      "A2UI catalog capabilities: available catalog IDs and custom component definitions",
    value:
      "Available A2UI catalog:\n- copilotkit://app-dashboard-catalog\n  Extends the basic catalog with all standard components plus: Metric, PieChart, BarChart, FlightCard, …",
  },
  {
    description:
      "A2UI Component Schema — available components for generating UI surfaces.",
    value:
      '{"catalogId":"copilotkit://app-dashboard-catalog","components":{"Metric":{},"PieChart":{},"FlightCard":{}}}',
  },
  {
    description: "A2UI generation guidelines — protocol rules, tool arguments.",
    value:
      "Generate A2UI v0.9 JSON.\n\n## A2UI Protocol Instructions\nCRITICAL: …",
  },
];

/** Shape the bridge builds: `requestContext.set("ag-ui", { context })`. */
const execCtx = (context: unknown) => ({
  requestContext: {
    get: (key: string) => (key === "ag-ui" ? { context } : undefined),
  },
});

describe("readForwardedA2uiContext", () => {
  it("reads the entries the bridge forwarded under the ag-ui key", () => {
    expect(readForwardedA2uiContext(execCtx(forwardedContext))).toEqual(
      forwardedContext,
    );
  });

  it("degrades to [] when there is no request context (falls back to the arg)", () => {
    expect(readForwardedA2uiContext(undefined)).toEqual([]);
    expect(readForwardedA2uiContext({})).toEqual([]);
    expect(readForwardedA2uiContext({ requestContext: {} })).toEqual([]);
  });

  it("degrades to [] for an unexpected ag-ui shape (non-array context)", () => {
    expect(readForwardedA2uiContext(execCtx(undefined))).toEqual([]);
    expect(readForwardedA2uiContext(execCtx("not-an-array"))).toEqual([]);
  });
});

describe("generate_a2ui grounding source", () => {
  it("the empty ARG the outer model sends yields an UNGROUNDED prompt (the bug)", () => {
    // Reproduces the live payload: contextEntries === [].
    const prep = generateA2uiImpl({ messages: [], contextEntries: [] });
    expect(prep.systemPrompt).toBe("");
  });

  it("the forwarded request context yields a GROUNDED prompt (the fix)", () => {
    const prep = generateA2uiImpl({
      messages: [],
      contextEntries: readForwardedA2uiContext(execCtx(forwardedContext)),
    });
    expect(prep.systemPrompt.length).toBeGreaterThan(0);
    expect(prep.systemPrompt).toContain("copilotkit://app-dashboard-catalog");
    expect(prep.systemPrompt).toContain("FlightCard");
    expect(prep.systemPrompt).toContain("A2UI Protocol Instructions");
  });
});
