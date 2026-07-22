import { access } from "node:fs/promises";
import { IntelligenceSdkError } from "@copilotkit/intelligence";
import type { InstalledSkillSet } from "@copilotkit/intelligence";
import { AIMessage, SystemMessage, fakeModel } from "langchain";
import type { ModelRequest, WrapModelCallHandler } from "langchain";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createSkillRegistryMiddleware } from "./index.js";
import type {
  AdapterSnapshot,
  SkillRegistryTelemetryEvent,
} from "./middleware.js";
import {
  deferred,
  cleanupInstalledSkillSets,
  installedSkillSet,
  testClient,
} from "../tests/test-utils.js";

const CONTAINER_ID = "55555555-5555-4555-8555-555555555555";

function captureUnhandledRejections() {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  return {
    reasons,
    stop: () => process.off("unhandledRejection", onUnhandled),
  };
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }) as const,
    (reason: unknown) => ({ status: "rejected", reason }) as const,
  );
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<PromiseSettledResult<T> | { readonly status: "timeout" }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settle(promise),
      new Promise<{ readonly status: "timeout" }>((resolveTimeout) => {
        timeout = setTimeout(
          () => resolveTimeout({ status: "timeout" }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function modelRequest(): ModelRequest {
  return {
    systemMessage: new SystemMessage("base"),
    systemPrompt: "base",
    messages: [],
    state: { messages: [] },
    model: fakeModel(),
    tools: [],
    runtime: {},
    modelSettings: { temperature: 0 },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await cleanupInstalledSkillSets();
});

afterAll(cleanupInstalledSkillSets);

describe("createSkillRegistryMiddleware", () => {
  it("recursively removes installed skill fixtures", async () => {
    const fixture = await installedSkillSet();

    await cleanupInstalledSkillSets();

    await expect(access(fixture.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("blocks a cold native model hook until loading completes", async () => {
    const pending = deferred<InstalledSkillSet>();
    const registryClient = testClient(() => pending.promise);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
    });
    let forwarded: Parameters<WrapModelCallHandler>[0] | undefined;
    const handler: WrapModelCallHandler = vi.fn(async (request) => {
      forwarded = request;
      return new AIMessage("done");
    });
    const request = modelRequest();

    const call = middleware.wrapModelCall(request, handler);
    await Promise.resolve();
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();

    pending.resolve(await installedSkillSet());
    await call;
    expect(handler).toHaveBeenCalledOnce();
    expect(forwarded).toMatchObject({
      state: request.state,
      tools: request.tools,
      modelSettings: request.modelSettings,
    });
    expect(forwarded?.systemMessage?.content).toBe(
      `base\n\n${middleware.snapshot.prompt}`,
    );
  });

  it("retries a stale native model hook at the failed throttle boundary", async () => {
    let now = 0;
    const failure = new IntelligenceSdkError({
      message: "refresh unavailable",
      code: "LEARNING_SDK_CACHE_CORRUPT",
      category: "dependency",
      retryable: true,
    });
    const response = vi
      .fn<() => Promise<InstalledSkillSet>>()
      .mockResolvedValueOnce(await installedSkillSet())
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(await installedSkillSet());
    const registryClient = testClient(response);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      clock: () => now,
    });
    await middleware.preload();
    now = 30_000;
    const handler: WrapModelCallHandler = vi.fn(async () =>
      Promise.resolve(new AIMessage("done")),
    );

    await expect(
      middleware.wrapModelCall(modelRequest(), handler),
    ).rejects.toBe(failure);
    expect(handler).not.toHaveBeenCalled();
    expect(registryClient.skills.get).toHaveBeenCalledTimes(2);
    expect(middleware.status).toBe("stale");

    now = 59_999;
    await expect(
      middleware.wrapModelCall(modelRequest(), handler),
    ).rejects.toMatchObject({ code: "LEARNING_REGISTRY_STALE" });
    expect(registryClient.skills.get).toHaveBeenCalledTimes(2);

    now = 60_000;
    await expect(
      middleware.wrapModelCall(modelRequest(), handler),
    ).resolves.toBeInstanceOf(AIMessage);
    expect(registryClient.skills.get).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalledOnce();
    expect(middleware.status).toBe("ready");
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
      reason: {
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: sinkFailure,
      },
    });
    expect(secondResult).toMatchObject({
      status: "rejected",
      reason: firstResult.status === "rejected" ? firstResult.reason : null,
    });
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
  });

  it("returns the exact in-flight promise to joined public callers", async () => {
    const pending = deferred<InstalledSkillSet>();
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });

    const first = middleware.load();
    const second = middleware.load();

    expect(second).toBe(first);
    pending.resolve(await installedSkillSet());
    await expect(first).resolves.toMatchObject({ status: "ready" });
  });

  it("shares the published promise with an external caller while telemetry is pending", async () => {
    const pending = deferred<InstalledSkillSet>();
    const telemetryStarted = deferred<void>();
    const releaseTelemetry = deferred<void>();
    const registryClient = testClient(() => pending.promise);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      telemetry: async (event) => {
        if (event.name === "load.started") {
          telemetryStarted.resolve();
          await releaseTelemetry.promise;
        }
      },
    });

    const initiating = middleware.load();
    await telemetryStarted.promise;
    const joined = middleware.load();
    const results = Promise.allSettled([initiating, joined]);
    releaseTelemetry.resolve();
    pending.resolve(await installedSkillSet());
    const [initiatingResult, joinedResult] = await results;

    expect(joined).toBe(initiating);
    expect(initiatingResult).toMatchObject({
      status: "fulfilled",
      value: { status: "ready" },
    });
    expect(joinedResult).toMatchObject({
      status: "fulfilled",
      value: { status: "ready" },
    });
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
  });

  it("rejects an awaited telemetry-context reentrant load instead of deadlocking", async () => {
    const installed = await installedSkillSet({ revoked: true });
    const registryClient = testClient(() => Promise.resolve(installed));
    const unhandled = captureUnhandledRejections();
    let middleware!: ReturnType<typeof createSkillRegistryMiddleware>;
    let reentrantResult:
      | Promise<PromiseSettledResult<AdapterSnapshot>>
      | undefined;
    middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      telemetry: async (event) => {
        if (event.name !== "load.started" || reentrantResult !== undefined)
          return;
        const reentrant = middleware.load();
        reentrantResult = settle(reentrant);
        await reentrant;
      },
    });

    try {
      const result = await settleWithin(middleware.load(), 100);

      expect(result.status).toBe("rejected");
      if (result.status !== "rejected" || reentrantResult === undefined) {
        throw new Error("The outer and reentrant loads must both reject");
      }
      const reentrant = await reentrantResult;
      expect(reentrant.status).toBe("rejected");
      if (reentrant.status !== "rejected") {
        throw new Error("The reentrant load must reject");
      }
      expect(reentrant.reason).toMatchObject({
        code: "LEARNING_REGISTRY_REENTRANT_LOAD",
        category: "lifecycle",
        retryable: false,
        causeIdentity: "telemetry-reentrant-load-1",
      });
      expect(result.reason).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: reentrant.reason,
      });
      expect(middleware.snapshot).toMatchObject({
        status: "denied",
        source: "none",
        installedSkillSet: null,
        renderedSkills: [],
        prompt: "",
        error: result.reason,
      });
      expect(registryClient.skills.get).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("denies and clears a shared throttled load when telemetry fails", async () => {
    const installed = await installedSkillSet();
    const registryClient = testClient(() => Promise.resolve(installed));
    const sinkFailure = new Error("throttled telemetry unavailable");
    let failThrottledTelemetry = false;
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      clock: () => 0,
      telemetry: (event) => {
        if (failThrottledTelemetry && event.name === "load.throttled") {
          throw sinkFailure;
        }
      },
    });
    await middleware.load();
    failThrottledTelemetry = true;

    const first = middleware.load();
    const second = middleware.load();
    const [firstResult, secondResult] = await Promise.allSettled([
      first,
      second,
    ]);

    expect(second).toBe(first);
    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    if (
      firstResult.status !== "rejected" ||
      secondResult.status !== "rejected"
    ) {
      throw new Error("Every throttled caller must reject");
    }
    expect(firstResult.reason).toBe(secondResult.reason);
    expect(firstResult.reason).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      category: "internal",
      retryable: false,
      cause: sinkFailure,
      causeIdentity: sinkFailure.message,
    });
    expect(middleware.snapshot).toMatchObject({
      status: "denied",
      source: "none",
      installedSkillSet: null,
      renderedSkills: [],
      prompt: "",
      error: firstResult.reason,
    });
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
  });

  it("singleflights stale throttled telemetry failure into denied state", async () => {
    const clientFailure = new IntelligenceSdkError({
      message: "registry unavailable",
      code: "LEARNING_SDK_CACHE_CORRUPT",
      category: "dependency",
      retryable: true,
    });
    const sinkFailure = new Error("stale throttle telemetry unavailable");
    const registryClient = testClient(() => Promise.reject(clientFailure));
    const unhandled = captureUnhandledRejections();
    let failThrottle = false;
    let throttledEvents = 0;
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      clock: () => 0,
      telemetry: (event) => {
        if (event.name === "load.throttled") {
          throttledEvents += 1;
          if (failThrottle) throw sinkFailure;
        }
      },
    });

    try {
      await expect(middleware.load()).rejects.toBe(clientFailure);
      expect(middleware.status).toBe("stale");
      failThrottle = true;

      const first = middleware.load();
      const second = middleware.load();
      expect(second).toBe(first);
      const [firstResult, secondResult] = await Promise.allSettled([
        first,
        second,
      ]);

      expect(firstResult.status).toBe("rejected");
      expect(secondResult.status).toBe("rejected");
      if (
        firstResult.status !== "rejected" ||
        secondResult.status !== "rejected"
      ) {
        throw new Error("Every stale throttled caller must reject");
      }
      expect(secondResult.reason).toBe(firstResult.reason);
      expect(firstResult.reason).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: sinkFailure,
      });
      expect(middleware.snapshot).toMatchObject({
        status: "denied",
        source: "none",
        installedSkillSet: null,
        renderedSkills: [],
        prompt: "",
        error: firstResult.reason,
      });
      expect(throttledEvents).toBe(1);
      expect(registryClient.skills.get).toHaveBeenCalledOnce();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("awaits and canonicalizes asynchronous joined telemetry failures", async () => {
    const pending = deferred<InstalledSkillSet>();
    const joinedWrite = deferred<void>();
    const sinkFailure = new Error("asynchronous telemetry unavailable");
    const events: string[] = [];
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
      telemetry: async (event) => {
        events.push(event.name);
        if (event.name === "load.singleflight_joined") {
          await joinedWrite.promise;
        }
      },
    });

    const first = middleware.load();
    const second = middleware.load();
    pending.resolve(await installedSkillSet());
    await new Promise<void>((resolve) => setImmediate(resolve));

    const results = Promise.allSettled([first, second]);
    joinedWrite.reject(sinkFailure);
    const [firstResult, secondResult] = await results;

    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    if (firstResult.status !== "rejected" || secondResult.status !== "rejected")
      throw new Error("Both joined callers must reject");
    expect(firstResult.reason).toBe(secondResult.reason);
    expect(firstResult.reason).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      category: "internal",
      retryable: false,
      cause: sinkFailure,
    });
    expect(middleware.status).toBe("denied");
    expect(events).toEqual([
      "load.started",
      "load.singleflight_joined",
      "status.changed",
      "load.failed",
    ]);
  });

  it("defers callers that arrive after joined telemetry is sealed", async () => {
    const sinkFailure = new Error("late joined sink failure");
    const unhandled = captureUnhandledRejections();
    let middleware!: ReturnType<typeof createSkillRegistryMiddleware>;
    let joined: Promise<AdapterSnapshot> | undefined;
    let joinedWrites = 0;
    let lateJoinScheduled = false;
    middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "load.succeeded" && !lateJoinScheduled) {
          lateJoinScheduled = true;
          queueMicrotask(() =>
            queueMicrotask(() =>
              queueMicrotask(() =>
                queueMicrotask(() => {
                  joined = middleware.load();
                }),
              ),
            ),
          );
        }
        if (event.name === "load.singleflight_joined") {
          joinedWrites += 1;
          throw sinkFailure;
        }
      },
    });

    try {
      const first = middleware.load();
      const firstResult = await settle(first);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(joined).not.toBe(first);
      if (joined === undefined)
        throw new Error("The deferred caller must be scheduled");
      const joinedResult = await settle(joined);
      expect(firstResult.status).toBe("fulfilled");
      expect(joinedResult.status).toBe("fulfilled");
      if (
        firstResult.status !== "fulfilled" ||
        joinedResult.status !== "fulfilled"
      ) {
        throw new Error("The sealed and deferred loads must both fulfill");
      }
      expect(joinedResult.value).toBe(firstResult.value);
      expect(joinedWrites).toBe(0);
      expect(middleware.status).toBe("ready");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("observes every joined telemetry rejection while the Registry request is pending", async () => {
    const pending = deferred<InstalledSkillSet>();
    const firstSinkFailure = new Error("first joined sink failure");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    let joinedWrites = 0;
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name !== "load.singleflight_joined") return;
        joinedWrites += 1;
        if (joinedWrites === 1) throw firstSinkFailure;
        return Promise.reject("second joined sink failure");
      },
    });
    process.on("unhandledRejection", onUnhandled);

    try {
      const first = middleware.load();
      const second = middleware.load();
      const third = middleware.load();

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);

      pending.resolve(await installedSkillSet());
      const results = await Promise.allSettled([first, second, third]);
      expect(results).toHaveLength(3);
      expect(results.every(({ status }) => status === "rejected")).toBe(true);
      const reasons = results.map((result) =>
        result.status === "rejected" ? result.reason : undefined,
      );
      expect(reasons[1]).toBe(reasons[0]);
      expect(reasons[2]).toBe(reasons[0]);
      expect(reasons[0]).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: firstSinkFailure,
      });
      expect(joinedWrites).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("preserves the first joined telemetry failure when the Registry request also fails", async () => {
    const pending = deferred<InstalledSkillSet>();
    const statusWriteStarted = deferred<void>();
    const statusWrite = deferred<void>();
    const lateJoinedWrite = deferred<void>();
    const clientFailure = new IntelligenceSdkError({
      message: "registry unavailable",
      code: "LEARNING_SDK_CACHE_CORRUPT",
      category: "dependency",
      retryable: true,
    });
    const firstSinkFailure = new Error("first joined sink failure");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    let joinedWrites = 0;
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "status.changed") {
          statusWriteStarted.resolve();
          return statusWrite.promise;
        }
        if (event.name !== "load.singleflight_joined") return;
        joinedWrites += 1;
        if (joinedWrites === 1) throw firstSinkFailure;
        if (joinedWrites === 2) {
          return Promise.reject("second joined sink failure");
        }
        return lateJoinedWrite.promise;
      },
    });
    process.on("unhandledRejection", onUnhandled);

    try {
      const readiness = middleware.waitUntilReady({ timeoutMs: 1_000 });
      const first = middleware.load();
      const second = middleware.load();
      const third = middleware.load();
      const callerResults = Promise.allSettled([first, second, third]);
      const readinessResult = Promise.allSettled([readiness]);
      let loadSettled = false;
      void first.then(
        () => {
          loadSettled = true;
        },
        () => {
          loadSettled = true;
        },
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      pending.reject(clientFailure);
      await statusWriteStarted.promise;

      const fourth = middleware.load();
      expect(fourth).toBe(first);
      const fourthResult = Promise.allSettled([fourth]);
      statusWrite.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(loadSettled).toBe(false);
      expect(unhandled).toEqual([]);
      lateJoinedWrite.reject("third joined sink failure");

      const results = await callerResults;
      const [lastResult] = await fourthResult;
      const [waiterResult] = await readinessResult;
      const allResults = [...results, lastResult, waiterResult];
      expect(allResults.every((result) => result?.status === "rejected")).toBe(
        true,
      );
      const reasons = allResults.map((result) =>
        result?.status === "rejected" ? result.reason : undefined,
      );
      expect(reasons.every((reason) => reason === reasons[0])).toBe(true);
      expect(reasons[0]).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: firstSinkFailure,
      });
      expect(joinedWrites).toBe(3);
      expect(middleware.status).toBe("denied");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports adapter version and refresh latency on telemetry", async () => {
    let now = 0;
    const pending = deferred<InstalledSkillSet>();
    const events: SkillRegistryTelemetryEvent[] = [];
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: CONTAINER_ID,
      clock: () => now,
      telemetry: (event) => {
        events.push(event);
      },
    });

    const load = middleware.load();
    now = 3;
    pending.resolve(await installedSkillSet());
    await load;

    expect(
      events.every((event) => event.metadata.adapterVersion === "0.1.0"),
    ).toBe(true);
    const succeeded = events.find(({ name }) => name === "load.succeeded");
    expect(succeeded?.metadata.refreshLatencyMs).toBe(3);
  });

  it("canonicalizes a primitive sink failure after readiness observes the pointer swap", async () => {
    vi.useFakeTimers();
    const pending = deferred<InstalledSkillSet>();
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => pending.promise),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "load.succeeded") {
          return Promise.reject("primitive-sink-1");
        }
      },
    });
    const readiness = middleware.waitUntilReady({ timeoutMs: 100 });
    const first = middleware.load();
    const second = middleware.load();
    const callers = Promise.allSettled([first, second]);
    const readinessResult = Promise.allSettled([readiness]);

    pending.resolve(await installedSkillSet());
    const [firstResult, secondResult] = await callers;
    await vi.advanceTimersByTimeAsync(100);
    const [waiterResult] = await readinessResult;

    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    expect(waiterResult?.status).toBe("fulfilled");
    if (
      firstResult.status !== "rejected" ||
      secondResult.status !== "rejected" ||
      waiterResult?.status !== "fulfilled"
    ) {
      throw new Error("Joined callers must reject after readiness settles");
    }
    expect(firstResult.reason).toBe(secondResult.reason);
    expect(firstResult.reason).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      category: "internal",
      retryable: false,
      cause: "primitive-sink-1",
      causeIdentity: "primitive-sink-1",
    });
    expect(waiterResult.value).toMatchObject({ status: "ready" });
    expect(middleware.status).toBe("denied");
  });

  it("settles readiness when client-failure status telemetry rejects", async () => {
    vi.useFakeTimers();
    const clientFailure = new IntelligenceSdkError({
      message: "denied",
      code: "LEARNING_CONTAINER_NOT_FOUND",
      category: "not_found",
      retryable: false,
      status: 404,
    });
    const sinkFailure = new Error("status-sink-1");
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => Promise.reject(clientFailure)),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "status.changed") throw sinkFailure;
      },
    });
    const readiness = middleware.waitUntilReady({ timeoutMs: 100 });
    const [loadResult] = await Promise.allSettled([middleware.load()]);
    const readinessResult = Promise.allSettled([readiness]);
    await vi.advanceTimersByTimeAsync(100);
    const [waiterResult] = await readinessResult;

    expect(loadResult?.status).toBe("rejected");
    expect(waiterResult?.status).toBe("rejected");
    if (
      loadResult?.status !== "rejected" ||
      waiterResult?.status !== "rejected"
    ) {
      throw new Error("Load and readiness waiter must reject");
    }
    expect(loadResult.reason).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      cause: sinkFailure,
    });
    expect(waiterResult.reason).toBe(clientFailure);
    expect(middleware.status).toBe("denied");
  });

  it("settles readiness when close status telemetry rejects", async () => {
    vi.useFakeTimers();
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "status.changed") {
          return Promise.reject("close-sink-1");
        }
      },
    });
    const readiness = middleware.waitUntilReady({ timeoutMs: 100 });
    const [closeResult] = await Promise.allSettled([middleware.close()]);
    const readinessResult = Promise.allSettled([readiness]);
    await vi.advanceTimersByTimeAsync(100);
    const [waiterResult] = await readinessResult;

    expect(closeResult?.status).toBe("rejected");
    expect(waiterResult?.status).toBe("rejected");
    if (
      closeResult?.status !== "rejected" ||
      waiterResult?.status !== "rejected"
    ) {
      throw new Error("Close and readiness waiter must reject");
    }
    expect(closeResult.reason).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      cause: "close-sink-1",
    });
    expect(waiterResult.reason).toMatchObject({
      code: "LEARNING_REGISTRY_CLOSED",
    });
    expect(middleware.status).toBe("closed");
  });

  it("shares close completion and telemetry failure across concurrent callers", async () => {
    const statusWrite = deferred<void>();
    const unhandled = captureUnhandledRejections();
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "status.changed") return statusWrite.promise;
      },
    });

    try {
      const first = middleware.close();
      const second = middleware.close();
      expect(second).toBe(first);
      const results = Promise.allSettled([first, second]);
      const sinkFailure = new Error("close telemetry unavailable");
      statusWrite.reject(sinkFailure);
      const [firstResult, secondResult] = await results;

      expect(firstResult.status).toBe("rejected");
      expect(secondResult.status).toBe("rejected");
      if (
        firstResult.status !== "rejected" ||
        secondResult.status !== "rejected"
      ) {
        throw new Error("Every concurrent close caller must reject");
      }
      expect(secondResult.reason).toBe(firstResult.reason);
      expect(firstResult.reason).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: sinkFailure,
      });
      expect(middleware.close()).toBe(first);
      expect(middleware.status).toBe("closed");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("rejects telemetry-context close reentrancy instead of deadlocking", async () => {
    const unhandled = captureUnhandledRejections();
    let middleware!: ReturnType<typeof createSkillRegistryMiddleware>;
    let reentrantResult: Promise<PromiseSettledResult<void>> | undefined;
    middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
      telemetry: async (event) => {
        if (event.name !== "status.changed" || reentrantResult !== undefined)
          return;
        const reentrant = middleware.close();
        reentrantResult = settle(reentrant);
        await reentrant;
      },
    });

    try {
      const first = middleware.close();
      const result = await settleWithin(first, 100);

      expect(result.status).toBe("rejected");
      if (result.status !== "rejected" || reentrantResult === undefined) {
        throw new Error("The outer and reentrant closes must both reject");
      }
      const reentrant = await reentrantResult;
      expect(reentrant.status).toBe("rejected");
      if (reentrant.status !== "rejected") {
        throw new Error("The reentrant close must reject");
      }
      expect(reentrant.reason).toMatchObject({
        code: "LEARNING_REGISTRY_REENTRANT_CLOSE",
        category: "lifecycle",
        retryable: false,
        causeIdentity: "telemetry-reentrant-close-1",
      });
      expect(result.reason).toMatchObject({
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        cause: reentrant.reason,
      });
      expect(middleware.close()).toBe(first);
      expect(middleware.status).toBe("closed");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("rejects pending readiness before blocked close telemetry completes", async () => {
    vi.useFakeTimers();
    const blockedStatusWrite = new Promise<void>(() => undefined);
    let statusWriteStarted = false;
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        if (event.name === "status.changed") {
          statusWriteStarted = true;
          return blockedStatusWrite;
        }
      },
    });
    let readinessFailure: unknown;
    const readiness = middleware
      .waitUntilReady({ timeoutMs: 10 })
      .catch((error: unknown) => {
        readinessFailure = error;
      });

    void middleware.close();
    await vi.advanceTimersByTimeAsync(0);

    expect(statusWriteStarted).toBe(true);
    expect(middleware.status).toBe("closed");
    expect(readinessFailure).toMatchObject({
      code: "LEARNING_REGISTRY_CLOSED",
      causeIdentity: "closed-1",
    });
    await vi.advanceTimersByTimeAsync(10);
    await readiness;
  });

  it("keeps close terminal while a failed shared load drains joined telemetry", async () => {
    const pending = deferred<InstalledSkillSet>();
    const joinedWrite = deferred<void>();
    const clientFailure = new Error("registry unavailable");
    const events: Array<{
      readonly name: SkillRegistryTelemetryEvent["name"];
      readonly status?: SkillRegistryTelemetryEvent["metadata"]["status"];
    }> = [];
    const registryClient = testClient(() => pending.promise);
    const middleware = createSkillRegistryMiddleware({
      client: registryClient,
      learningContainerId: CONTAINER_ID,
      telemetry: (event) => {
        events.push({ name: event.name, status: event.metadata.status });
        if (event.name === "load.singleflight_joined") {
          return joinedWrite.promise;
        }
      },
    });

    const first = middleware.load();
    const second = middleware.load();
    expect(second).toBe(first);
    const callers = Promise.allSettled([first, second]);

    pending.reject(clientFailure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(middleware.status).toBe("loading");

    await middleware.close();
    const closedFailure = middleware.snapshot.error;
    expect(middleware.status).toBe("closed");

    joinedWrite.resolve();
    const [firstResult, secondResult] = await callers;
    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    if (
      firstResult.status !== "rejected" ||
      secondResult.status !== "rejected"
    ) {
      throw new Error("Both shared load callers must reject");
    }
    expect(firstResult.reason).toBe(secondResult.reason);
    expect(firstResult.reason).toBe(closedFailure);
    expect(firstResult.reason).toMatchObject({
      code: "LEARNING_REGISTRY_CLOSED",
      causeIdentity: "closed-1",
    });
    expect(middleware.status).toBe("closed");
    expect(events).toEqual([
      { name: "load.started", status: undefined },
      { name: "load.singleflight_joined", status: undefined },
      { name: "status.changed", status: "closed" },
    ]);

    await expect(middleware.load()).rejects.toBe(closedFailure);
    expect(registryClient.skills.get).toHaveBeenCalledOnce();
    expect(events).toHaveLength(3);
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

  it("preserves the native system message identity for an empty prompt", async () => {
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet({ revoked: true })),
      learningContainerId: CONTAINER_ID,
    });
    const request = modelRequest();
    let forwarded: Parameters<WrapModelCallHandler>[0] | undefined;
    const handler: WrapModelCallHandler = vi.fn(async (next) => {
      forwarded = next;
      return new AIMessage("done");
    });

    await middleware.wrapModelCall(request, handler);

    expect(forwarded?.systemMessage).toBe(request.systemMessage);
  });

  it("does not prepend a separator to an empty native base prompt", async () => {
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: CONTAINER_ID,
    });
    const request = {
      ...modelRequest(),
      systemMessage: new SystemMessage(""),
      systemPrompt: "",
    };
    let forwarded: Parameters<WrapModelCallHandler>[0] | undefined;
    const handler: WrapModelCallHandler = vi.fn(async (next) => {
      forwarded = next;
      return new AIMessage("done");
    });

    await middleware.wrapModelCall(request, handler);

    expect(forwarded?.systemMessage?.content).toBe(middleware.snapshot.prompt);
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
