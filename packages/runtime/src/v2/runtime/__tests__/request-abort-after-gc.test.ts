import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";

const handleRunAgent = vi.fn();
vi.mock("../handlers/handle-run", () => ({
  handleRunAgent: (...args: unknown[]) => handleRunAgent(...args),
}));

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

it.each([
  ["multi-route", "/api/agent/default/run", {}],
  [
    "single-route",
    "/api",
    { method: "agent/run", params: { agentId: "default" }, body: {} },
  ],
] as const)(
  "a client abort still reaches the run after a GC (%s)",
  async (mode, path, body) => {
    const controller = new AbortController();
    const seen = new Promise<Request>((resolve) => {
      handleRunAgent.mockImplementation(async ({ request }) => {
        resolve(request);
        return new Response(null, { status: 204 });
      });
    });
    const handler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: { default: {} as AbstractAgent },
      }),
      basePath: "/api",
      mode,
    });

    await handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
    );
    const request = await seen;

    for (let i = 0; i < 5; i++) {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort();

    expect(request.signal.aborted).toBe(true);
  },
);
