import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";
import { LearnedSkillsError } from "../learned-skills";
import type { LearnedSkillsSnapshotResult } from "../learned-skills";
import {
  SkillRegistry,
  resolveRegistryConfig,
  loadSkill,
  readSkillFile,
} from "../skill-registry";
import type { SkillRegistryOptions } from "../skill-registry";
import fixtures from "../../../../../../intelligence-delivery-core/conformance/snapshots.v1.json";

function response(name = "text-skill"): LearnedSkillsSnapshotResult {
  const fixture = fixtures.cases.find((entry) => entry.name === name)!;
  return {
    status: "snapshot",
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  };
}
function setup() {
  const client = new CopilotKitIntelligence({ apiKey: "test" });
  const fetch = vi
    .spyOn(client, "getLearnedSkillsSnapshot")
    .mockResolvedValue(response());
  const registry = new SkillRegistry({
    client,
    containers: [{ id: "support", revision: "r1" }, { id: "company" }],
    freshnessWindowMs: 0,
  });
  return { registry, fetch };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("multiple learned skill containers", () => {
  it("keeps both colliding skills and routes reads through the qualified name", async () => {
    const { registry, fetch } = setup();
    const snapshot = await registry.acquireSnapshot();
    expect(snapshot.skills.map((skill) => skill.name)).toEqual([
      "support/refund-policy",
      "company/refund-policy",
    ]);
    expect(
      JSON.parse(loadSkill(snapshot, "support/refund-policy")).content,
    ).toContain("published refund policy");
    expect(
      JSON.parse(loadSkill(snapshot, "company/refund-policy")).skill_name,
    ).toBe("company/refund-policy");
    expect(
      readSkillFile(snapshot, "company/refund-policy", "SKILL.md"),
    ).toContain("published refund policy");
    expect(() => loadSkill(snapshot, "refund-policy")).toThrow("unavailable");
    expect(
      fetch.mock.calls.map(([arg]) => [arg.containerId, arg.revision]),
    ).toEqual([
      ["support", "r1"],
      ["company", undefined],
    ]);
    expect(registry.status.containers).toMatchObject([
      { id: "support", revision: "r1", mode: "pinned" },
      { id: "company", revision: "r1", mode: "latest" },
    ]);
    expect(registry.status.revision).toBeUndefined();
    expect(Object.isFrozen(snapshot.skills[0])).toBe(true);
  });
  it("ignores legacy source environment in new mode but keeps legacy defaults", () => {
    const env = {
      CPK_INTELLIGENCE_API_KEY: "key",
      CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: "old",
      CPK_INTELLIGENCE_SKILLS_REVISION: "old-pin",
    };
    expect(resolveRegistryConfig({}, env)).toMatchObject({
      containerId: "old",
      revision: "old-pin",
    });
    expect(
      resolveRegistryConfig({ containers: [{ id: "new" }] }, env),
    ).toMatchObject({ containers: [{ id: "new" }] });
    vi.stubEnv("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", "old");
    vi.stubEnv("CPK_INTELLIGENCE_SKILLS_REVISION", "old-pin");
    const { registry, fetch } = setup();
    return registry
      .acquireSnapshot()
      .then(() => expect(fetch.mock.calls[1][0].revision).toBeUndefined());
  });
  it.each([
    { containers: [] },
    { containers: null },
    { containers: "a" },
    { containers: [{ id: "" }] },
    { containers: [{ id: " " }] },
    { containers: [{ id: "a" }, { id: "a" }] },
    { containers: [{ id: "a", revision: "" }] },
    { containers: [{ id: "a" }], containerId: "a" },
    { containers: [{ id: "a" }], revision: "r1" },
  ])("rejects invalid or mixed selection %j", (selection) => {
    expect(() =>
      resolveRegistryConfig(
        { apiKey: "test", ...selection } as SkillRegistryOptions,
        {},
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
  });
  it("copies caller-owned source configuration and encodes separators", async () => {
    const client = new CopilotKitIntelligence({ apiKey: "test" });
    const fetch = vi
      .spyOn(client, "getLearnedSkillsSnapshot")
      .mockResolvedValue(response());
    const containers = [{ id: "a/b" }];
    const registry = new SkillRegistry({ client, containers });
    containers[0].id = "changed";
    expect((await registry.acquireSnapshot()).skills[0].name).toBe(
      "a%2Fb/refund-policy",
    );
    expect(fetch.mock.calls[0][0].containerId).toBe("a/b");
  });
  it("coalesces concurrent acquisition and sends each container its own ETag", async () => {
    const { registry, fetch } = setup();
    fetch.mockImplementation(async ({ containerId }) =>
      response(containerId === "support" ? "text-skill" : "empty-r2"),
    );
    const [first, second] = await Promise.all([
      registry.acquireSnapshot(),
      registry.acquireSnapshot(),
    ]);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockImplementation(async ({ containerId }) => {
      const previous = response(
        containerId === "support" ? "text-skill" : "empty-r2",
      );
      return {
        status: "unchanged",
        revision: previous.revision,
        etag: previous.etag,
      };
    });
    expect(await registry.acquireSnapshot()).toBe(first);
    expect(fetch.mock.calls.slice(2).map(([arg]) => arg.ifNoneMatch)).toEqual([
      response().etag,
      response("empty-r2").etag,
    ]);
  });
  it("retains invocation snapshots while another container publishes a replacement", async () => {
    const { registry, fetch } = setup();
    const first = await registry.acquireSnapshot();
    fetch.mockImplementation(async ({ containerId }) =>
      response(containerId === "support" ? "text-skill" : "empty-r2"),
    );
    const second = await registry.acquireSnapshot();
    expect(second.skills).toHaveLength(1);
    expect(first.skills).toHaveLength(2);
    expect(loadSkill(first, "company/refund-policy")).toContain(
      "published refund policy",
    );
  });
  it("fails cold acquisition when any container is unavailable", async () => {
    const { registry, fetch } = setup();
    fetch.mockImplementation(async ({ containerId }) => {
      if (containerId === "company")
        throw new LearnedSkillsError("NETWORK_ERROR", true);
      return response();
    });
    await expect(registry.acquireSnapshot()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(registry.status.initialized).toBe(false);
  });
  it("uses per-container stale fallback but cannot bypass a confirmed denial", async () => {
    const { registry, fetch } = setup();
    const first = await registry.acquireSnapshot();
    fetch.mockImplementation(async ({ containerId }) => {
      if (containerId === "company")
        throw new LearnedSkillsError("NETWORK_ERROR", true);
      return response();
    });
    expect((await registry.acquireSnapshot()).skills).toEqual(first.skills);
    expect(registry.status.stale).toBe(true);
    fetch.mockImplementation(async ({ containerId }) => {
      if (containerId === "company")
        throw new LearnedSkillsError("DELIVERY_DISABLED", false);
      return response();
    });
    await expect(registry.acquireSnapshot()).rejects.toMatchObject({
      code: "DELIVERY_DISABLED",
    });
    fetch.mockRejectedValue(new LearnedSkillsError("NETWORK_ERROR", true));
    await expect(registry.acquireSnapshot()).rejects.toMatchObject({
      code: "DELIVERY_DISABLED",
    });
  });
});

// The public SDK configuration rejects ambiguous combinations at compile time.
const valid: SkillRegistryOptions = { containers: [{ id: "a" }] };
// @ts-expect-error Old and new container selectors are mutually exclusive.
const mixed: SkillRegistryOptions = {
  containers: [{ id: "a" }],
  containerId: "b",
};
// @ts-expect-error Revision pins belong on the selected container in new mode.
const mixedPin: SkillRegistryOptions = {
  containers: [{ id: "a" }],
  revision: "r1",
};
void [valid, mixed, mixedPin];
