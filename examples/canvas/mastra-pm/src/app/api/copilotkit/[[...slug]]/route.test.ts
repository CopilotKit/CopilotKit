// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("@/agent", async () => {
  const { HttpAgent } = await import("@ag-ui/client");
  return {
    createLocalAgents: () => ({
      default: new HttpAgent({ url: "http://unused.test" }),
    }),
  };
});

/** Load a route with local agents stubbed; the runtime routing remains real. */
async function setup() {
  const route: Record<string, unknown> = await import("./route");
  return {
    request: async (method: string, path: string) => {
      const handler = route[method];
      expect(typeof handler).toBe("function");
      if (typeof handler !== "function")
        throw new Error(`Missing ${method} route`);
      return await handler(
        new Request(`http://localhost/api/copilotkit${path}`, { method }),
      );
    },
  };
}

test("GET exposes the registered project agent through runtime discovery", async () => {
  const { request } = await setup();

  const response = await request("GET", "/info");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    agents: { default: expect.any(Object) },
  });
});

test("POST reaches the v2 run endpoint and reports invalid input", async () => {
  const { request } = await setup();

  const response = await request("POST", "/agent/default/run");

  expect(response.status).toBe(400);
});
