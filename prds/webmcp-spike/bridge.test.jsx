import { describe, it, expect, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import React from "react";
import { z } from "zod";
import { installModelContextShim } from "./modelcontext-shim.js";
import { CoreMock, useFrontendTool } from "./core-mock.jsx";
import { useWebMCPBridge, schemaToJsonSchema } from "./bridge.jsx";

let mc, core;
beforeEach(() => { mc = installModelContextShim(document); core = new CoreMock(); });

function Harness({ tool, mounted = true }) {
  useWebMCPBridge(core);
  return mounted ? <ToolHost tool={tool} /> : null;
}
function ToolHost({ tool }) { useFrontendTool(core, tool); return null; }

const setBook = {
  name: "setBookingDetails",
  description: "Set the booking city and number of nights",
  parameters: z.object({ city: z.string().describe("Destination city"), nights: z.number() }),
  handler: async ({ city, nights }) => ({ confirmed: true, city, nights }),
};

describe("EXPORT: useFrontendTool -> WebMCP", () => {
  it("exposes the tool to an external agent, schema and all", async () => {
    render(<Harness tool={setBook} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    const [t] = await mc.getTools();
    expect(t.name).toBe("setBookingDetails");
    expect(t.description).toBe("Set the booking city and number of nights");
    expect(t.inputSchema.properties.city).toMatchObject({ type: "string", description: "Destination city" });
    expect(t.inputSchema.properties.nights).toMatchObject({ type: "number" });
    expect(t.inputSchema.required).toEqual(["city", "nights"]);
  });

  it("an external agent can EXECUTE it and reach the CopilotKit handler", async () => {
    render(<Harness tool={setBook} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    const raw = await mc.executeTool({ name: "setBookingDetails" }, { city: "Lisbon", nights: 3 });
    expect(typeof raw).toBe("string"); // spec: executeTool resolves to a STRING
    expect(JSON.parse(raw)).toEqual({ confirmed: true, city: "Lisbon", nights: 3 });
  });

  it("unmount unregisters via AbortSignal (React cleanup maps 1:1)", async () => {
    const { rerender } = render(<Harness tool={setBook} mounted />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    rerender(<Harness tool={setBook} mounted={false} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(0));
  });

  it("surfaces handler errors as structured data (spec drops rejection reasons)", async () => {
    const boom = { ...setBook, name: "boom", handler: async () => { throw new Error("Payment declined: card expired"); } };
    render(<Harness tool={boom} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    const parsed = JSON.parse(await mc.executeTool({ name: "boom" }, {}));
    expect(parsed).toEqual({ ok: false, error: "Payment declined: card expired" });
  });

  it("respects available:false and per-tool webmcp:false opt-out", async () => {
    render(<Harness tool={{ ...setBook, available: false }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(await mc.getTools()).toHaveLength(0);
  });

  it("propagates cancellation into the handler signal (the HITL path)", async () => {
    let sawAbort = false;
    const hitl = { name: "confirm", description: "Ask the user to confirm",
      handler: (_a, { signal }) => new Promise((_res, rej) => {
        signal.addEventListener("abort", () => { sawAbort = true; rej(new Error("aborted")); });
      }) };
    render(<Harness tool={hitl} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    const ac = new AbortController();
    const p = mc.executeTool({ name: "confirm" }, {}, { signal: ac.signal });
    ac.abort(new Error("user navigated away"));
    await expect(p).rejects.toBeTruthy();
    expect(sawAbort).toBe(true);
  });

  it("sanitizes names that WebMCP would reject", async () => {
    render(<Harness tool={{ ...setBook, name: "search products (beta)!" }} />);
    await waitFor(async () => expect(await mc.getTools()).toHaveLength(1));
    expect((await mc.getTools())[0].name).toBe("search_products__beta__");
  });
});

// ---------------------------------------------------------------------------
// IMPORT direction: a raw JSON Schema from a WebMCP tool must satisfy
// FrontendTool.parameters (StandardSchemaV1) with ZERO core changes.
// ---------------------------------------------------------------------------
function jsonSchemaToStandardSchema(schema) {
  return { "~standard": { version: 1, vendor: "webmcp",
    validate: (value) => ({ value }), jsonSchema: { input: () => schema } } };
}

describe("IMPORT: WebMCP -> CopilotKit", () => {
  it("wraps a raw JSON Schema so core's schemaToJsonSchema round-trips it", () => {
    const raw = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    const wrapped = jsonSchemaToStandardSchema(raw);
    expect(schemaToJsonSchema(wrapped)).toEqual(raw); // core needs no changes
  });

  it("loop guard: an imported tool is never re-exported to WebMCP", async () => {
    const imported = { name: "third_party_widget", description: "from an iframe",
      handler: async () => "ok", __fromWebMCP: true };
    render(<Harness tool={imported} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(await mc.getTools()).toHaveLength(0);
  });
});
