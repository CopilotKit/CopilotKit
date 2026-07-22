import type { InstalledSkillSet } from "@copilotkit/intelligence";
import { AIMessage, SystemMessage, fakeModel } from "langchain";
import type { ModelRequest } from "langchain";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import corpus from "../../intelligence/conformance/registry-adapters-v1.json" with { type: "json" };
import { createSkillRegistryMiddleware } from "./index.js";
import type {
  AdapterStatus,
  SkillRegistryTelemetryEvent,
} from "./middleware.js";
import {
  TestCanonicalError,
  cleanupInstalledSkillSets,
  deferred,
  installedSkillSet,
  testClient,
} from "../tests/test-utils.js";
import { assertConformanceObservation } from "../tests/conformance-harness.js";
import type {
  ConformanceObservation,
  ConformanceTelemetryRecord,
} from "../tests/conformance-harness.js";

const CONTAINER_ID = corpus.fixtures.learningContainerId;
type CorpusCase = (typeof corpus.cases)[number];
type CorpusOperation = CorpusCase["operations"][number];

interface Transition {
  readonly atMs: number;
  readonly from: AdapterStatus;
  readonly to: AdapterStatus;
}

interface ObservedCanonicalError extends Error {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly causeIdentity?: string;
}

function isCanonicalError(error: unknown): error is ObservedCanonicalError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "category" in error &&
    typeof error.category === "string" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  );
}

function observeError(error: unknown) {
  if (!isCanonicalError(error)) {
    throw new Error("Expected a canonical Registry error", { cause: error });
  }
  return {
    code: error.code,
    category: error.category,
    retryable: error.retryable,
    ...(typeof error.status === "number" ? { httpStatus: error.status } : {}),
    ...(error.causeIdentity ? { causeIdentity: error.causeIdentity } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.traceId ? { traceId: error.traceId } : {}),
  };
}

function wireError(options: {
  readonly code: string;
  readonly category: string;
  readonly status?: number;
  readonly causeIdentity: string;
}): TestCanonicalError {
  return new TestCanonicalError({
    ...options,
    retryable: false,
    requestId: "request-telemetry",
    traceId: "trace-telemetry",
  });
}

function permanentDenialError(
  source: NonNullable<CorpusCase["permanentDenialSource"]>,
): TestCanonicalError {
  switch (source) {
    case "error-category-auth":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "auth",
        causeIdentity: source,
      });
    case "error-category-permission":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "permission",
        causeIdentity: source,
      });
    case "http-401":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "auth",
        status: 401,
        causeIdentity: source,
      });
    case "http-403":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "permission",
        status: 403,
        causeIdentity: source,
      });
    case "http-404":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "not_found",
        status: 404,
        causeIdentity: source,
      });
    case "http-410":
      return wireError({
        code: "LEARNING_REGISTRY_DENIED",
        category: "permission",
        status: 410,
        causeIdentity: source,
      });
    case "container-archived":
      return wireError({
        code: "LEARNING_CONTAINER_ARCHIVED",
        category: "conflict",
        status: 409,
        causeIdentity: source,
      });
    case "project-mismatch":
      return wireError({
        code: "LEARNING_CONTAINER_PROJECT_MISMATCH",
        category: "permission",
        status: 403,
        causeIdentity: source,
      });
    case "container-not-found":
      return wireError({
        code: "LEARNING_CONTAINER_NOT_FOUND",
        category: "not_found",
        status: 404,
        causeIdentity: source,
      });
    case "registry-unrecoverable":
      return wireError({
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "internal",
        status: 500,
        causeIdentity: source,
      });
    default:
      throw new Error(`Unsupported permanent denial source: ${source}`);
  }
}

function failureForOperation(
  case_: CorpusCase,
  operation: CorpusOperation,
): TestCanonicalError {
  if (operation.kind === "transient-failure") {
    return new TestCanonicalError({
      code: "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
      category: "availability",
      retryable: true,
      causeIdentity: "transient-1",
    });
  }
  if (operation.kind === "integrity-failure") {
    return new TestCanonicalError({
      code: "LEARNING_BLOB_INTEGRITY_FAILURE",
      category: "validation",
      retryable: false,
      causeIdentity: "integrity-1",
    });
  }
  if (operation.kind === "denial-response") {
    return wireError({
      code: "LEARNING_REGISTRY_DENIED",
      category: "permission",
      status: 403,
      causeIdentity: "denial-1",
    });
  }
  if (case_.permanentDenialSource) {
    return permanentDenialError(case_.permanentDenialSource);
  }
  throw new Error(`Operation ${operation.kind} does not define a failure`);
}

function initialError(case_: CorpusCase): TestCanonicalError {
  const snapshot = case_.initialSnapshot;
  if (!("error" in snapshot) || !snapshot.error) {
    throw new Error("The initial snapshot does not declare an error");
  }
  return new TestCanonicalError({
    code: snapshot.error.code,
    category: snapshot.error.category,
    retryable: snapshot.error.retryable,
    ...(snapshot.error.httpStatus ? { status: snapshot.error.httpStatus } : {}),
    causeIdentity: snapshot.error.causeIdentity,
  });
}

function observedValue(
  case_: CorpusCase,
  kind: CorpusOperation["kind"],
): number {
  const operation = case_.operations.find(
    (candidate) => candidate.kind === kind,
  );
  if (
    !operation ||
    !("observed" in operation) ||
    typeof operation.observed !== "number"
  ) {
    throw new Error(`${kind} must declare its observed value`);
  }
  return operation.observed;
}

function resultForOperations(case_: CorpusCase): Promise<InstalledSkillSet> {
  const kinds = new Set(case_.operations.map(({ kind }) => kind));
  if (kinds.has("validate-count")) {
    return installedSkillSet({ count: observedValue(case_, "validate-count") });
  }
  if (kinds.has("validate-instruction-bytes")) {
    return installedSkillSet({
      text: "x".repeat(observedValue(case_, "validate-instruction-bytes")),
    });
  }
  if (kinds.has("validate-aggregate-bytes")) {
    const maximum = corpus.fixtures.limits.maximumInstructionBytes;
    return installedSkillSet({
      count: 5,
      texts: [
        "x".repeat(maximum),
        "x".repeat(maximum),
        "x".repeat(maximum),
        "x".repeat(maximum),
        "x".repeat(
          observedValue(case_, "validate-aggregate-bytes") - maximum * 4,
        ),
      ],
    });
  }
  if (kinds.has("decode-instruction")) {
    return installedSkillSet({ rawBytes: Uint8Array.from([0xff]) });
  }
  if (kinds.has("reject-script")) {
    return installedSkillSet({
      files: [{ path: "scripts/run.sh", role: "script" }],
    });
  }
  const cached = kinds.has("cached-preload");
  const empty = kinds.has("render") && !kinds.has("bundle-request") && !cached;
  return installedSkillSet({
    count: empty ? 0 : 1,
    revoked: kinds.has("revocation-observed"),
    freshness: cached ? "cached" : "fresh",
    registryRevision: kinds.has("changed-projection")
      ? corpus.fixtures.changedRegistryRevision
      : corpus.fixtures.registryRevision,
  });
}

function telemetryObservation(events: readonly SkillRegistryTelemetryEvent[]) {
  return events.map((event) => {
    const { framework, adapterVersion, refreshLatencyMs, ...metadata } =
      event.metadata;
    expect(framework).toBe("langgraph-typescript");
    expect(adapterVersion).toBe("0.1.0");
    if (event.name === "load.succeeded") {
      expect(refreshLatencyMs).toEqual(expect.any(Number));
    } else {
      expect(refreshLatencyMs).toBeUndefined();
    }
    return {
      name: event.name,
      atMs: event.atMs,
      metadata: { ...metadata, framework: "fixture" as const },
    };
  });
}

function withWrongTelemetryMetadata(
  actual: ConformanceObservation,
): ConformanceObservation {
  const first = actual.telemetryRecords[0];
  if (!first) throw new Error("Mutation guard requires a telemetry record");
  const changed: ConformanceTelemetryRecord = {
    name: first.name,
    atMs: first.atMs,
    metadata: { source: "refresh", framework: "fixture" },
  };
  return {
    ...actual,
    telemetryRecords: [changed, ...actual.telemetryRecords.slice(1)],
  };
}

async function executeCase(case_: CorpusCase): Promise<void> {
  const kinds = new Set(case_.operations.map(({ kind }) => kind));
  if (kinds.has("timeout")) vi.useFakeTimers();

  let now = 0;
  let recordTelemetry = false;
  const events: SkillRegistryTelemetryEvent[] = [];
  const transitions: Transition[] = [];
  const operations: CorpusOperation[] = [];
  const pendingRequests: ReturnType<typeof deferred<InstalledSkillSet>>[] = [];
  let responseFactory = () => {
    const pending = deferred<InstalledSkillSet>();
    pendingRequests.push(pending);
    return pending.promise;
  };
  const client = testClient(() => responseFactory());
  const joinedTelemetry = deferred<void>();
  const sinkFailure = new Error("sink-exception-1");
  const middleware = createSkillRegistryMiddleware({
    client,
    learningContainerId: CONTAINER_ID,
    refreshIntervalMs: corpus.fixtures.limits.throttleWindowMs,
    maximumSkills: corpus.fixtures.limits.maximumSkills,
    maximumInstructionBytes: corpus.fixtures.limits.maximumInstructionBytes,
    maximumAggregateBytes: corpus.fixtures.limits.maximumAggregateBytes,
    clock: () => now,
    telemetry: async (event) => {
      if (recordTelemetry) events.push(event);
      if (
        kinds.has("telemetry-write") &&
        event.name === "load.singleflight_joined"
      ) {
        await joinedTelemetry.promise;
      }
    },
  });

  const seedReady = async (freshness: "fresh" | "cached") => {
    responseFactory = () =>
      installedSkillSet({
        freshness,
        registryRevision: corpus.fixtures.registryRevision,
      });
    now =
      case_.initialSnapshot.refreshDue ||
      case_.initialSnapshot.status === "stale"
        ? -corpus.fixtures.limits.throttleWindowMs
        : (case_.initialSnapshot.lastAttemptAt ?? 0);
    if (freshness === "cached") await middleware.preloadCached();
    else await middleware.preload();
  };

  if (
    case_.initialSnapshot.status === "ready" ||
    case_.initialSnapshot.status === "stale"
  ) {
    await seedReady(
      case_.initialSnapshot.source === "fresh" ? "fresh" : "cached",
    );
  }
  if (case_.initialSnapshot.status === "stale") {
    responseFactory = () => Promise.reject(initialError(case_));
    now = 0;
    await middleware.load().catch(() => undefined);
  } else if (case_.initialSnapshot.status === "denied") {
    responseFactory = () => Promise.reject(initialError(case_));
    now = 0;
    await middleware.load().catch(() => undefined);
  }

  responseFactory = () => {
    const pending = deferred<InstalledSkillSet>();
    pendingRequests.push(pending);
    return pending.promise;
  };
  client.skills.get.mockClear();
  client.skills.getCached.mockClear();
  now = 0;
  recordTelemetry = true;

  let observedStatus = middleware.status;
  let thrown: unknown;
  let closeCount = 0;
  let readiness: ConformanceObservation["readiness"] | undefined;
  let readinessPending: Promise<typeof middleware.snapshot> | undefined;
  let readinessObservationPending: Promise<void> | undefined;
  const activeLoads: Promise<typeof middleware.snapshot>[] = [];
  const activeLoadNames: string[] = [];
  let activeLoadResults: PromiseSettledResult<typeof middleware.snapshot>[] =
    [];

  const recordTransition = (atMs: number, before: AdapterStatus) => {
    const after = middleware.status;
    if (before !== after) transitions.push({ atMs, from: before, to: after });
    observedStatus = after;
  };

  const startLoad = (
    operation: CorpusOperation,
    load: () => Promise<typeof middleware.snapshot>,
  ) => {
    const before = middleware.status;
    const promise = load();
    activeLoads.push(promise);
    activeLoadNames.push(
      operation.kind === "load-caller-a"
        ? "caller-a"
        : operation.kind === "load-caller-b"
          ? "caller-b"
          : operation.kind,
    );
    recordTransition(operation.atMs, before);
    return promise;
  };

  const waitForRequest = async () => {
    for (let turn = 0; turn < 8 && pendingRequests.length === 0; turn += 1) {
      await Promise.resolve();
    }
    const pending = pendingRequests.shift();
    if (!pending) throw new Error("No Registry request is pending");
    return pending;
  };

  const observeActiveLoads = async (atMs: number) => {
    activeLoadResults = await Promise.allSettled(activeLoads);
    const rejection = activeLoadResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejection) thrown = rejection.reason;
    const before = observedStatus;
    recordTransition(atMs, before);
  };

  const settleSuccess = async (operation: CorpusOperation) => {
    const pending = await waitForRequest();
    now = operation.atMs;
    pending.resolve(await resultForOperations(case_));
    await observeActiveLoads(operation.atMs);
  };

  const settleFailure = async (operation: CorpusOperation) => {
    const pending = await waitForRequest();
    now = operation.atMs;
    pending.reject(failureForOperation(case_, operation));
    await observeActiveLoads(operation.atMs);
  };

  const captureReadiness = async (
    promise: Promise<typeof middleware.snapshot>,
  ) => {
    try {
      readiness = { result: { state: (await promise).status } };
    } catch (error) {
      thrown = error;
      readiness = { error: observeError(error) };
    }
  };

  for (const [index, operation] of case_.operations.entries()) {
    operations.push(operation);
    now = operation.atMs;
    const next = case_.operations[index + 1];
    switch (operation.kind) {
      case "load": {
        if (next?.kind === "throttle-hit") now = next.atMs;
        const load = startLoad(operation, () => middleware.load());
        if (middleware.status === "closed") {
          const [result] = await Promise.allSettled([load]);
          if (result?.status === "rejected") thrown = result.reason;
        }
        break;
      }
      case "cached-preload":
        startLoad(operation, () => middleware.preloadCached());
        break;
      case "load-caller-a":
        startLoad(operation, () => middleware.load());
        break;
      case "load-caller-b": {
        const joined = startLoad(operation, () => middleware.load());
        expect(joined).toBe(activeLoads[0]);
        break;
      }
      case "registry-request":
        startLoad(operation, () => middleware.load());
        break;
      case "bundle-request":
        if (!next) await settleSuccess(operation);
        break;
      case "render":
      case "not-modified":
      case "revocation-observed":
      case "validate-count":
      case "validate-instruction-bytes":
      case "validate-aggregate-bytes":
      case "decode-instruction":
      case "reject-script":
        await settleSuccess(operation);
        break;
      case "transient-failure":
      case "integrity-failure":
      case "denial-response":
      case "registry-error":
      case "http-response":
      case "canonical-error":
        await settleFailure(operation);
        break;
      case "telemetry-write": {
        const pending = await waitForRequest();
        now = operation.atMs;
        pending.resolve(await resultForOperations(case_));
        joinedTelemetry.reject(sinkFailure);
        await observeActiveLoads(operation.atMs);
        break;
      }
      case "throttle-check": {
        const before = middleware.status;
        const [result] = await Promise.allSettled([middleware.load()]);
        if (result?.status === "rejected") thrown = result.reason;
        recordTransition(operation.atMs, before);
        break;
      }
      case "throttle-hit":
        await observeActiveLoads(operation.atMs);
        break;
      case "close": {
        const before = middleware.status;
        await middleware.close();
        if (before !== "closed") closeCount += 1;
        recordTransition(operation.atMs, before);
        break;
      }
      case "readiness": {
        const timeout =
          next?.kind === "timeout" ? next.atMs - operation.atMs : 0;
        readinessPending = middleware.waitUntilReady({ timeoutMs: timeout });
        readinessObservationPending = captureReadiness(readinessPending);
        if (next?.kind !== "timeout") await readinessObservationPending;
        break;
      }
      case "timeout":
        await vi.advanceTimersByTimeAsync(operation.atMs);
        if (!readinessPending || !readinessObservationPending) {
          throw new Error("No readiness wait is pending");
        }
        await readinessObservationPending;
        break;
      case "projection-request":
      case "conditional-projection-request":
      case "cache-read":
      case "changed-projection":
        break;
      default:
        throw new Error(`Unsupported operation ${JSON.stringify(operation)}`);
    }
  }

  if (!readiness) {
    await captureReadiness(middleware.waitUntilReady({ timeoutMs: 0 }));
  }

  let genericSdk: ConformanceObservation["genericSdk"];
  const onlyCloses = case_.operations.every(({ kind }) => kind === "close");
  const attemptedLoad = case_.operations.some(
    ({ kind }) =>
      kind === "load" ||
      kind === "load-caller-a" ||
      kind === "registry-request" ||
      kind === "cached-preload",
  );
  if (middleware.status === "closed" && onlyCloses) {
    genericSdk = { result: { state: middleware.status, closeCount } };
  } else if (
    middleware.status === "ready" ||
    middleware.status === "revoked" ||
    (middleware.status === "stale" && attemptedLoad)
  ) {
    genericSdk = {
      result: {
        state: middleware.status,
        freshness:
          middleware.status === "stale" ? "stale" : middleware.snapshot.source,
        registryRevision: middleware.snapshot.registryRevision ?? "",
        skillCount: middleware.snapshot.renderedSkills.length,
        aggregateByteLength: middleware.snapshot.renderedSkills.reduce(
          (total, skill) => total + skill.byteLength,
          0,
        ),
      },
    };
  } else {
    genericSdk = { error: observeError(thrown ?? middleware.snapshot.error) };
  }

  const request: ModelRequest = {
    systemMessage: new SystemMessage("base"),
    systemPrompt: "base",
    messages: [],
    state: { messages: [] },
    model: fakeModel(),
    tools: [],
    runtime: {},
  };
  const handler = vi.fn(async () => new AIMessage("done"));
  const observedCalls = {
    client: {
      get: client.skills.get.mock.calls.length,
      getCached: client.skills.getCached.mock.calls.length,
    },
    routing: { readiness: 1 as const, nativeHook: 1 as const },
  };
  const observedTelemetry = telemetryObservation(events);
  const observedTransitions = [...transitions];
  const observedRenderedRecords =
    middleware.status === "stale" && !attemptedLoad
      ? []
      : [...middleware.snapshot.renderedSkills];
  recordTelemetry = false;
  if (middleware.status === "cold") {
    responseFactory = () =>
      Promise.reject(
        new TestCanonicalError({
          code: "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
          category: "availability",
          retryable: true,
          causeIdentity: "native-hook-cold-proof",
        }),
      );
  }
  let nativeHook: ConformanceObservation["nativeHook"];
  try {
    await middleware.wrapModelCall(request, handler);
    nativeHook = { proceed: true };
  } catch {
    nativeHook = { proceed: false };
  }

  let singleflight: ConformanceObservation["singleflight"];
  if ("singleflight" in case_.expected) {
    const firstCaller = activeLoadNames.indexOf("caller-a");
    const secondCaller = activeLoadNames.indexOf("caller-b");
    const firstResult = activeLoadResults[firstCaller];
    const secondResult = activeLoadResults[secondCaller];
    if (
      firstResult?.status !== "rejected" ||
      secondResult?.status !== "rejected" ||
      !isCanonicalError(firstResult.reason) ||
      !isCanonicalError(secondResult.reason)
    ) {
      throw new Error("Single-flight callers must reject canonically");
    }
    expect(firstResult.reason).toBe(secondResult.reason);
    expect(firstResult.reason.cause).toBe(sinkFailure);
    expect(secondResult.reason.cause).toBe(sinkFailure);
    const barrier = case_.operations.find(
      (operation) =>
        operation.kind === "load-caller-a" && "barrier" in operation,
    );
    if (
      !barrier ||
      !("barrier" in barrier) ||
      typeof barrier.barrier !== "string"
    ) {
      throw new Error("Single-flight case must declare its barrier");
    }
    singleflight = {
      barrier: barrier.barrier,
      registryCalls: client.skills.get.mock.calls.length,
      sinkExceptionIdentity: sinkFailure.message,
      callers: [
        {
          name: "caller-a",
          rejectionIdentity: firstResult.reason.causeIdentity ?? "",
          causeIdentity:
            firstResult.reason.cause === sinkFailure ? sinkFailure.message : "",
        },
        {
          name: "caller-b",
          rejectionIdentity: secondResult.reason.causeIdentity ?? "",
          causeIdentity:
            secondResult.reason.cause === sinkFailure
              ? sinkFailure.message
              : "",
        },
      ],
    };
  }

  assertConformanceObservation(case_, {
    operations,
    calls: observedCalls,
    statusTransitions: observedTransitions,
    genericSdk,
    readiness,
    nativeHook,
    telemetryRecords: observedTelemetry,
    renderedRecords: observedRenderedRecords,
    ...(singleflight ? { singleflight } : {}),
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await cleanupInstalledSkillSets();
});

afterAll(cleanupInstalledSkillSets);

describe.each(corpus.cases)("adapter conformance: $name", (case_) => {
  it("executes every declared operation and exact observable contract", async () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.contractVersion).toBe("registry-adapters-v1");
    expect(case_.operations.map(({ atMs }) => atMs)).toEqual(
      [...case_.operations]
        .map(({ atMs }) => atMs)
        .sort((left, right) => left - right),
    );
    await executeCase(case_);
  });
});

describe("conformance harness mutation guards", () => {
  const case_ = corpus.cases[0]!;
  const observation: ConformanceObservation = {
    operations: case_.operations,
    calls: {
      client: {
        get: case_.expected.calls.client.get,
        getCached: case_.expected.calls.client.getCached,
      },
      routing: case_.expected.calls.routing,
    },
    statusTransitions: case_.expected.statusTransitions,
    genericSdk: case_.expected.genericSdk,
    readiness: case_.expected.readiness,
    nativeHook: case_.expected.nativeHook,
    telemetryRecords: case_.expected.telemetryRecords,
    renderedRecords: case_.expected.renderedRecords,
  };

  it.each([
    [
      "wrong operation",
      (actual: ConformanceObservation): ConformanceObservation => ({
        ...actual,
        operations: [{ ...case_.operations[0]!, kind: "close" }],
      }),
    ],
    [
      "wrong actual client call count",
      (actual: ConformanceObservation): ConformanceObservation => ({
        ...actual,
        calls: {
          ...observation.calls,
          client: {
            ...observation.calls.client,
            get: observation.calls.client.get + 1,
          },
        },
      }),
    ],
    [
      "wrong transition time",
      (actual: ConformanceObservation): ConformanceObservation => ({
        ...actual,
        statusTransitions: observation.statusTransitions.map((transition) => ({
          ...transition,
          atMs: transition.atMs + 1,
        })),
      }),
    ],
    [
      "missing telemetry event",
      (actual: ConformanceObservation): ConformanceObservation => ({
        ...actual,
        telemetryRecords: observation.telemetryRecords.slice(1),
      }),
    ],
    ["wrong telemetry metadata", withWrongTelemetryMetadata],
  ])("rejects a %s", (_name, mutate) => {
    expect(() =>
      assertConformanceObservation(case_, mutate(observation)),
    ).toThrow();
  });
});
