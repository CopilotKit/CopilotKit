import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { createCopilotEndpoint } from "../endpoints";
import { CopilotRuntime } from "../core/runtime";

/**
 * A single-route client (`useSingleEndpoint`) POSTs a `{ method }` envelope at
 * the base path. Against a multi-route runtime that path matches no route, so
 * the request 404s with nothing pointing at the cause — the failure mode behind
 * OSS-882. These tests pin the diagnostic the handler returns instead, and the
 * ordinary 404 it must keep returning for everything else.
 */
describe("single-route envelope against a multi-route runtime", () => {
  const createMockAgent = (): AbstractAgent => {
    const agent: unknown = { execute: async () => ({ events: [] }) };
    (agent as { clone: () => unknown }).clone = () => createMockAgent();
    return agent as AbstractAgent;
  };

  const createEndpoint = () =>
    createCopilotEndpoint({
      runtime: new CopilotRuntime({ agents: { default: createMockAgent() } }),
      basePath: "/api/copilotkit",
    });

  const postEnvelope = (body: unknown, contentType = "application/json") =>
    createEndpoint().fetch(
      new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: JSON.stringify(body),
      }),
    );

  it("names useSingleEndpoint when the envelope is an info call", async () => {
    const response = await postEnvelope({ method: "info" });
    expect(response.status).toBe(404);

    const body = (await response.json()) as Record<string, string>;
    expect(body.code).toBe("single_route_envelope_against_multi_route_runtime");
    expect(body.message).toContain("useSingleEndpoint");
    expect(body.message).toContain("single-route");
  });

  it("diagnoses every method the single-route envelope accepts", async () => {
    for (const method of [
      "info",
      "agent/run",
      "agent/suggest",
      "agent/connect",
      "agent/stop",
      "transcribe",
    ]) {
      const response = await postEnvelope({ method, params: { agentId: "x" } });
      const body = (await response.json()) as Record<string, string>;
      expect(body.code, `expected method "${method}" to be diagnosed`).toBe(
        "single_route_envelope_against_multi_route_runtime",
      );
    }
  });

  it("leaves an ordinary unmatched route as a plain 404", async () => {
    const response = await createEndpoint().fetch(
      new Request("https://example.com/api/copilotkit/nope", { method: "GET" }),
    );
    expect(response.status).toBe(404);

    const body = (await response.json()) as Record<string, string>;
    expect(body.code).toBeUndefined();
    expect(body.error).toBe("Not found");
  });

  it("leaves a JSON POST that is not an envelope as a plain 404", async () => {
    const response = await postEnvelope({ threadId: "t1", messages: [] });
    const body = (await response.json()) as Record<string, string>;
    expect(body.code).toBeUndefined();
    expect(body.error).toBe("Not found");
  });

  it("leaves an unrecognized method name as a plain 404", async () => {
    const response = await postEnvelope({ method: "definitely/not/a/method" });
    const body = (await response.json()) as Record<string, string>;
    expect(body.code).toBeUndefined();
  });

  it("does not diagnose a non-JSON POST", async () => {
    const response = await postEnvelope({ method: "info" }, "text/plain");
    const body = (await response.json()) as Record<string, string>;
    expect(body.code).toBeUndefined();
  });
});
