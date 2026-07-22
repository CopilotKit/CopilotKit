import {
  IntelligenceSdkError,
  type InstalledSkillSet,
} from "@copilotkit/intelligence";
import {
  AIMessage,
  SystemMessage,
  fakeModel,
  type ModelRequest,
  type WrapModelCallHandler,
} from "langchain";
import { describe, expect, it, vi } from "vitest";
import { createSkillRegistryMiddleware } from "./index.js";
import {
  deferred,
  installedSkillSet,
  testClient,
} from "../tests/test-utils.js";

describe("createSkillRegistryMiddleware", () => {
  it("loads before the native model hook", async () => {
    const pending = deferred<InstalledSkillSet>();
    const registryClient = testClient(() => pending.promise);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    let forwarded: Parameters<WrapModelCallHandler>[0] | undefined;
    const handler: WrapModelCallHandler = vi.fn(async (request) => {
      forwarded = request;
      return new AIMessage("done");
    });
    const request: ModelRequest = {
      systemMessage: new SystemMessage("base"),
      systemPrompt: "base",
      messages: [],
      state: { messages: [] },
      model: fakeModel(),
      tools: [],
      runtime: {},
      modelSettings: { temperature: 0 },
    };

    const call = middleware.wrapModelCall(request, handler);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();

    pending.resolve(await installedSkillSet());
    await call;
    expect(handler).toHaveBeenCalledOnce();
    expect(forwarded).toMatchObject({
      state: request.state,
      tools: request.tools,
      modelSettings: request.modelSettings,
    });
    expect(forwarded?.systemMessage?.content).toContain("# Skill");
  });

  it("retries after the failed throttle window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const failure = new IntelligenceSdkError({
      message: "unavailable",
      code: "LEARNING_SDK_CACHE_CORRUPT",
      category: "dependency",
      retryable: true,
    });
    const registryClient = testClient(
      vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(await installedSkillSet()),
    );
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
      clock: () => Date.now(),
    });

    await expect(middleware.load()).rejects.toBe(failure);
    vi.setSystemTime(29_999);
    await expect(middleware.load()).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_STALE",
    });
    expect(registryClient.skills.get).toHaveBeenCalledTimes(1);
    vi.setSystemTime(30_000);
    await expect(middleware.load()).resolves.toMatchObject({ status: "ready" });
    expect(registryClient.skills.get).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("shares telemetry sink failure across joined callers", async () => {
    const pending = deferred<InstalledSkillSet>();
    const registryClient = testClient(() => pending.promise);
    const sinkFailure = new Error("telemetry unavailable");
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
      telemetry: (event) => {
        if (event.name === "load.succeeded") throw sinkFailure;
      },
    });

    const first = middleware.load();
    const second = middleware.load();
    pending.resolve(await installedSkillSet());
    const [firstResult, secondResult] = await Promise.allSettled([
      first,
      second,
    ]);
    expect(firstResult).toMatchObject({
      status: "rejected",
      reason: sinkFailure,
    });
    expect(secondResult).toMatchObject({
      status: "rejected",
      reason: sinkFailure,
    });
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
  });

  it("rejects loads created after close", async () => {
    const registryClient = testClient(() => installedSkillSet());
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    await middleware.close();
    await middleware.close();
    await expect(middleware.load()).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_CLOSED",
    });
    expect(registryClient.skills.get).not.toHaveBeenCalled();
  });

  it("routes only explicit cached preload through getCached", async () => {
    const registryClient = testClient(() =>
      installedSkillSet({ freshness: "cached" }),
    );
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });

    await expect(middleware.preloadCached()).resolves.toMatchObject({
      status: "ready",
      source: "cached",
    });
    expect(registryClient.skills.getCached).toHaveBeenCalledOnce();
    expect(registryClient.skills.get).not.toHaveBeenCalled();
  });

  it("waits for readiness and rejects timeout, denial, stale, and closed states", async () => {
    const pending = deferred<InstalledSkillSet>();
    const registryClient = testClient(() => pending.promise);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    const load = middleware.load();
    const readiness = middleware.waitUntilReady({ timeoutMs: 1_000 });
    pending.resolve(await installedSkillSet());
    await load;
    await expect(readiness).resolves.toMatchObject({ status: "ready" });

    const cold = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    await expect(cold.waitUntilReady({ timeoutMs: 0 })).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_READINESS_TIMEOUT",
    });
    await cold.close();
    await expect(cold.waitUntilReady({ timeoutMs: 1 })).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_CLOSED",
    });
  });

  it("renders revoked as an authorized empty ready snapshot", async () => {
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet({ revoked: true })),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    await expect(middleware.load()).resolves.toMatchObject({
      status: "revoked",
      prompt: "",
      renderedSkills: [],
    });
    expect(middleware.ready).toBe(true);
  });

  it("fails the complete set for count, byte, aggregate, UTF-8, and script violations", async () => {
    const cases = [
      {
        options: { maximumSkills: 1 },
        result: installedSkillSet({ count: 2 }),
        code: "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS",
      },
      {
        options: { maximumInstructionBytes: 7 },
        result: installedSkillSet(),
        code: "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE",
      },
      {
        options: { maximumAggregateBytes: 15 },
        result: installedSkillSet({ count: 2 }),
        code: "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE",
      },
      {
        options: {},
        result: installedSkillSet({ rawBytes: Uint8Array.from([0xff]) }),
        code: "INTELLIGENCE_ADAPTER_INVALID_UTF8",
      },
      {
        options: {},
        result: installedSkillSet({
          files: [
            { path: "SKILL.md", role: "instructions" },
            { path: "scripts/run.sh", role: "script" },
          ],
        }),
        code: "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
      },
    ] as const;

    for (const case_ of cases) {
      const middleware = createSkillRegistryMiddleware({
        client: testClient(() => case_.result),
        learningContainerId: "55555555-5555-4555-8555-555555555555",
        ...case_.options,
      });
      await expect(middleware.load()).rejects.toMatchObject({
        code: case_.code,
      });
      expect(middleware).toMatchObject({ status: "denied", ready: false });
      expect(middleware.snapshot.renderedSkills).toEqual([]);
    }
  });

  it("emits only the documented telemetry whitelist", async () => {
    const events: object[] = [];
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
      telemetry: (event) => {
        events.push(event);
      },
    });
    await middleware.load();
    expect(events.map((event) => Object.keys(event).sort())).toEqual([
      ["atMs", "metadata", "name"],
      ["atMs", "metadata", "name"],
      ["atMs", "metadata", "name"],
    ]);
    expect(JSON.stringify(events)).not.toContain(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(JSON.stringify(events)).not.toContain("# Skill");
  });
});
