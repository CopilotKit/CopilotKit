import { describe, expect, it, vi } from "vitest";
import type { CopilotIntelligenceRuntimeLike } from "../../../core/runtime";
import { resolveIntelligenceGrant } from "../resolve-intelligence-grant";

const user = { id: "user-1", name: "Ada" };

function runtime(access?: unknown): CopilotIntelligenceRuntimeLike {
  return { access } as unknown as CopilotIntelligenceRuntimeLike;
}

async function resolve(access: unknown, request = new Request("https://x")) {
  return resolveIntelligenceGrant({
    runtime: runtime(access),
    request,
    user,
    surface: "inspector",
  });
}

describe("resolveIntelligenceGrant", () => {
  it("sends no grant when no access policy is configured", async () => {
    await expect(resolve(undefined)).resolves.toBeUndefined();
  });

  it("passes request, user and surface to the policy", async () => {
    const access = vi.fn().mockResolvedValue(null);
    const request = new Request("https://x");
    await resolve(access, request);
    expect(access).toHaveBeenCalledWith({
      request,
      user,
      surface: "inspector",
    });
  });

  it("maps a null grant to an explicit empty permission set", async () => {
    await expect(resolve(vi.fn().mockResolvedValue(null))).resolves.toEqual({
      permissions: {},
    });
  });

  it("returns a normalized copy of a valid grant", async () => {
    const agents = ["support", "billing"];
    const grant = await resolve(
      vi.fn().mockResolvedValue({
        permissions: {
          "analytics.numbers": { agents: "*" },
          "analytics.topics": { agents },
          "learning.insights_skills": { agents: [] },
          "governance.record": { agents: "*", extra: true },
          "conversations.text": { agents: ["support"] },
        },
        extra: "dropped",
      }),
    );
    expect(grant).toEqual({
      permissions: {
        "analytics.numbers": { agents: "*" },
        "analytics.topics": { agents: ["support", "billing"] },
        "learning.insights_skills": { agents: [] },
        "governance.record": { agents: "*" },
        "conversations.text": { agents: ["support"] },
      },
    });
    agents.push("mutated-later");
    expect(
      (grant as { permissions: Record<string, { agents: unknown }> })
        .permissions["analytics.topics"].agents,
    ).toEqual(["support", "billing"]);
  });

  it.each([
    ["undefined", undefined],
    ["a string", "all"],
    ["missing permissions", {}],
    ["array permissions", { permissions: [] }],
    [
      "an unknown permission",
      { permissions: { "admin.all": { agents: "*" } } },
    ],
    ["a missing scope", { permissions: { "analytics.numbers": null } }],
    [
      "a non-wildcard string scope",
      { permissions: { "analytics.numbers": { agents: "some" } } },
    ],
    [
      "a non-string agent id",
      { permissions: { "analytics.numbers": { agents: [1] } } },
    ],
    [
      "a blank agent id",
      { permissions: { "analytics.numbers": { agents: [" "] } } },
    ],
  ])("fails the request with 500 for %s", async (_label, value) => {
    const result = await resolve(vi.fn().mockResolvedValue(value));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
  });

  it("fails the request with 500 when the policy throws", async () => {
    const result = await resolve(vi.fn().mockRejectedValue(new Error("boom")));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
  });

  it("evaluates the policy once per request and surface", async () => {
    const access = vi.fn().mockResolvedValue(null);
    const request = new Request("https://x");
    const owner = runtime(access);
    const input = {
      runtime: owner,
      request,
      user,
      surface: "inspector",
    } as const;
    const first = await resolveIntelligenceGrant(input);
    const second = await resolveIntelligenceGrant(input);
    expect(second).toBe(first);
    expect(access).toHaveBeenCalledOnce();

    await resolve(access, new Request("https://x"));
    expect(access).toHaveBeenCalledTimes(2);
  });
});
