import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../../../core/runtime";
import type { IntelligenceAccessCallback } from "../../../core/runtime";
import { CopilotKitIntelligence } from "../../../intelligence-platform/client";
import { resolveIntelligenceGrant } from "../resolve-intelligence-grant";
import { resolveIntelligenceUser } from "../resolve-intelligence-user";

/** Creates a real Runtime without making platform requests. */
function setup(id: string, access: IntelligenceAccessCallback) {
  const identifyUser = vi.fn(async () => ({ id, name: id }));
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://intelligence.example",
      wsUrl: "wss://intelligence.example",
      apiKey: "test-server-only",
    }),
    identifyUser,
    access,
  });
  return { runtime, identifyUser };
}

test("different identity callbacks resolve independently on the same request", async () => {
  const first = setup("customer-a", async () => null);
  const second = setup("customer-b", async () => null);
  const request = new Request("https://customer.example");

  await resolveIntelligenceUser({ runtime: first.runtime, request });
  const result = await resolveIntelligenceUser({
    runtime: second.runtime,
    request,
  });

  expect(result).toEqual({ id: "customer-b", name: "customer-b" });
  expect(second.identifyUser).toHaveBeenCalledExactlyOnceWith(request);
});

test("a second policy cannot inherit the first policy's grant on the same request", async () => {
  const first = setup("customer", async () => ({
    permissions: { "governance.record": { agents: "*" } },
  }));
  const denied = vi.fn<IntelligenceAccessCallback>(async () => null);
  const second = setup("customer", denied);
  const request = new Request("https://customer.example");
  const user = { id: "customer", name: "Customer" };

  await resolveIntelligenceGrant({
    runtime: first.runtime,
    request,
    user,
    surface: "inspector",
  });
  const result = await resolveIntelligenceGrant({
    runtime: second.runtime,
    request,
    user,
    surface: "inspector",
  });

  expect(result).toEqual({ permissions: {} });
  expect(denied).toHaveBeenCalledOnce();
});

test("one policy resolves separately for distinct identities on the same request", async () => {
  const access = vi.fn<IntelligenceAccessCallback>(async ({ user }) =>
    user.id === "allowed"
      ? { permissions: { "analytics.numbers": { agents: "*" } } }
      : null,
  );
  const world = setup("allowed", access);
  const request = new Request("https://customer.example");

  await resolveIntelligenceGrant({
    runtime: world.runtime,
    request,
    user: { id: "allowed", name: "Allowed" },
    surface: "inspector",
  });
  const result = await resolveIntelligenceGrant({
    runtime: world.runtime,
    request,
    user: { id: "denied", name: "Denied" },
    surface: "inspector",
  });

  expect(result).toEqual({ permissions: {} });
  expect(access).toHaveBeenCalledTimes(2);
});

test("repeated identity resolution in one context still calls the callback once", async () => {
  const world = setup("customer", async () => null);
  const request = new Request("https://customer.example");

  const results = await Promise.all([
    resolveIntelligenceUser({ runtime: world.runtime, request }),
    resolveIntelligenceUser({ runtime: world.runtime, request }),
  ]);

  expect(results[0]).toBe(results[1]);
  expect(world.identifyUser).toHaveBeenCalledOnce();
});

test("a policy refresh rechecks access without borrowing another policy's cached grant", async () => {
  const access = vi
    .fn<IntelligenceAccessCallback>()
    .mockResolvedValueOnce({
      permissions: { "analytics.numbers": { agents: "*" } },
    })
    .mockResolvedValue(null);
  const world = setup("customer", access);
  const request = new Request("https://customer.example");
  const input = {
    runtime: world.runtime,
    request,
    user: { id: "customer", name: "Customer" },
    surface: "inspector",
  } as const;

  await resolveIntelligenceGrant(input);
  const result = await resolveIntelligenceGrant({ ...input, refresh: true });

  expect(result).toEqual({ permissions: {} });
  expect(access).toHaveBeenCalledTimes(2);
});

test("distinct Runtimes never share grant resolution even when they use the same callback", async () => {
  const access = vi.fn<IntelligenceAccessCallback>().mockResolvedValue(null);
  const first = setup("customer", access);
  const second = setup("customer", access);
  const request = new Request("https://customer.example");
  const user = { id: "customer", name: "Customer" };

  await resolveIntelligenceGrant({
    runtime: first.runtime,
    request,
    user,
    surface: "inspector",
  });
  await resolveIntelligenceGrant({
    runtime: second.runtime,
    request,
    user,
    surface: "inspector",
  });

  expect(access).toHaveBeenCalledTimes(2);
});
