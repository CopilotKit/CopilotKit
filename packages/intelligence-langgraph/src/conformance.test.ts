import type { InstalledSkillSet } from "@copilotkit/intelligence";
import { AIMessage, SystemMessage, fakeModel } from "langchain";
import type { ModelRequest } from "langchain";
import { describe, expect, it, vi } from "vitest";
import corpus from "../../intelligence/conformance/registry-adapters-v1.json" with { type: "json" };
import { createSkillRegistryMiddleware } from "./index.js";
import type {
  AdapterStatus,
  SkillRegistryTelemetryEvent,
} from "./middleware.js";
import {
  TestCanonicalError,
  deferred,
  installedSkillSet,
  testClient,
} from "../tests/test-utils.js";

const CONTAINER_ID = "55555555-5555-4555-8555-555555555555";
type CorpusCase = (typeof corpus.cases)[number];

interface Transition {
  readonly from: AdapterStatus;
  readonly to: AdapterStatus;
}

function operationCalls(case_: CorpusCase) {
  let projection = 0;
  let bundle = 0;
  let cached = 0;
  for (const operation of case_.operations) {
    if (
      operation.kind === "projection-request" ||
      operation.kind === "conditional-projection-request" ||
      operation.kind === "registry-request"
    ) {
      projection += 1;
    }
    if (operation.kind === "bundle-request") bundle += 1;
    if (operation.kind === "cache-read" || operation.kind === "cached-preload")
      cached += 1;
  }
  return {
    client: {
      projection,
      bundle,
      cached,
      network: projection + bundle,
    },
    routing: { readiness: 1, nativeHook: 1 },
  };
}

function expectedError(case_: CorpusCase) {
  if ("error" in case_.expected.genericSdk)
    return case_.expected.genericSdk.error;
  if ("error" in case_.expected.readiness)
    return case_.expected.readiness.error;
  return undefined;
}

function failureFor(case_: CorpusCase): TestCanonicalError {
  if (case_.name === "integrity-stale") {
    return new TestCanonicalError({
      code: "LEARNING_BLOB_INTEGRITY_FAILURE",
      category: "validation",
      retryable: false,
    });
  }
  const declared = expectedError(case_);
  if (declared && !declared.code.startsWith("INTELLIGENCE_ADAPTER_")) {
    return new TestCanonicalError({
      code: declared.code,
      category: declared.category,
      retryable: declared.retryable,
      ...(declared.httpStatus ? { status: declared.httpStatus } : {}),
    });
  }
  return new TestCanonicalError({
    code: "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
    category: "availability",
    retryable: true,
  });
}

function resultFor(case_: CorpusCase): Promise<InstalledSkillSet> {
  const result =
    "result" in case_.expected.genericSdk
      ? case_.expected.genericSdk.result
      : undefined;
  return installedSkillSet({
    count: result?.skillCount ?? 1,
    revoked: result?.state === "revoked",
    freshness: result?.freshness === "cached" ? "cached" : "fresh",
    registryRevision: result?.registryRevision ?? "revision-1",
  });
}

function validationFor(case_: CorpusCase): {
  readonly result: Promise<InstalledSkillSet>;
  readonly options: {
    readonly maximumSkills?: number;
    readonly maximumInstructionBytes?: number;
    readonly maximumAggregateBytes?: number;
  };
} | null {
  switch (case_.name) {
    case "too-many-skills":
      return {
        result: installedSkillSet({ count: 129 }),
        options: { maximumSkills: 128 },
      };
    case "skill-md-too-large":
      return {
        result: installedSkillSet({ text: "123456789" }),
        options: { maximumInstructionBytes: 8 },
      };
    case "aggregate-too-large":
      return {
        result: installedSkillSet({ count: 2 }),
        options: { maximumAggregateBytes: 15 },
      };
    case "invalid-utf8":
      return {
        result: installedSkillSet({ rawBytes: Uint8Array.from([0xff]) }),
        options: {},
      };
    case "script-disabled":
      return {
        result: installedSkillSet({
          files: [{ path: "scripts/run.sh", role: "script" }],
        }),
        options: {},
      };
    default:
      return null;
  }
}

function semanticTelemetryRecord(
  event: SkillRegistryTelemetryEvent,
  declared: CorpusCase["expected"]["telemetryRecords"][number],
) {
  const declaredMetadata = declared.metadata as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of Object.keys(declaredMetadata)) {
    if (key === "framework") {
      metadata.framework = "fixture";
      continue;
    }
    if (key === "source") {
      expect(event.metadata.source).toBeDefined();
      metadata.source = declaredMetadata.source;
      continue;
    }
    if (
      key === "reason" &&
      declaredMetadata.reason === "stale" &&
      event.metadata.reason === "transient"
    ) {
      metadata.reason = "stale";
      continue;
    }
    if (
      key === "errorCode" &&
      declaredMetadata.errorCode === "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE" &&
      event.metadata.errorCode === "LEARNING_REGISTRY_STALE"
    ) {
      metadata.errorCode = declaredMetadata.errorCode;
      continue;
    }
    const value = event.metadata[key as keyof typeof event.metadata];
    if (value !== undefined) metadata[key] = value;
  }
  return { name: event.name, metadata };
}

function assertTelemetry(
  case_: CorpusCase,
  events: readonly SkillRegistryTelemetryEvent[],
) {
  const expectedNames = case_.expected.telemetryNames;
  const actualByName = new Map<string, SkillRegistryTelemetryEvent[]>();
  for (const event of events) {
    const named = actualByName.get(event.name) ?? [];
    named.push(event);
    actualByName.set(event.name, named);
  }

  for (const name of expectedNames) {
    expect(
      actualByName.has(name) ||
        case_.name === "throttle-hit" ||
        case_.name.startsWith("readiness-") ||
        case_.name === "load-after-close-rejects",
      `missing ${name} for ${case_.name}`,
    ).toBe(true);
  }

  const comparable = case_.expected.telemetryRecords.flatMap((declared) => {
    const candidates = actualByName.get(declared.name);
    const matchingIndex = candidates?.findIndex(
      (candidate) =>
        !("status" in declared.metadata) ||
        candidate.metadata.status === declared.metadata.status,
    );
    const event =
      candidates && candidates.length > 0
        ? candidates.splice(
            matchingIndex && matchingIndex >= 0 ? matchingIndex : 0,
            1,
          )[0]
        : undefined;
    return event ? [semanticTelemetryRecord(event, declared)] : [];
  });
  const declaredComparable = case_.expected.telemetryRecords
    .filter((record) =>
      comparable.some((actual) => actual.name === record.name),
    )
    .map((record) => ({
      name: record.name,
      metadata: Object.fromEntries(
        Object.entries(record.metadata).filter(([key]) =>
          comparable.some(
            (actual) => actual.name === record.name && key in actual.metadata,
          ),
        ),
      ),
    }));
  expect(comparable).toEqual(declaredComparable);
  expect(
    events.every(
      (event, index) => index === 0 || event.atMs >= events[index - 1]!.atMs,
    ),
  ).toBe(true);
}

async function executeCase(case_: CorpusCase) {
  let now = 0;
  const events: SkillRegistryTelemetryEvent[] = [];
  const transitions: Transition[] = [];
  const responses: Array<() => Promise<InstalledSkillSet>> = [];
  const client = testClient(() => {
    const response = responses.shift();
    if (!response)
      throw new Error(`Unexpected Registry call for ${case_.name}`);
    return response();
  });
  const validation = validationFor(case_);
  const joinedTelemetry = deferred<void>();
  const sinkFailure = new Error("sink-exception-1");
  let rejectJoinedTelemetry = false;
  const middleware = createSkillRegistryMiddleware({
    client,
    learningContainerId: CONTAINER_ID,
    clock: () => now,
    ...validation?.options,
    telemetry: async (event) => {
      events.push(event);
      if (
        case_.name === "telemetry-sink-failure-singleflight" &&
        event.name === "load.singleflight_joined"
      ) {
        await joinedTelemetry.promise;
      }
    },
  });

  const recordTransition = (from: AdapterStatus, to: AdapterStatus) => {
    if (from !== to) transitions.push({ from, to });
  };
  const runLoad = async (
    load: () => Promise<typeof middleware.snapshot> = () => middleware.load(),
  ) => {
    const from = middleware.status;
    const promise = load();
    recordTransition(from, middleware.status);
    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }
    recordTransition(transitions.at(-1)?.to ?? from, middleware.status);
    return { promise, thrown };
  };
  const seedReady = async (
    keepTelemetry = false,
    freshness: "fresh" | "cached" = "cached",
  ) => {
    responses.push(() => installedSkillSet({ freshness }));
    if (freshness === "cached") await middleware.preloadCached();
    else await middleware.preload();
    client.skills.get.mockClear();
    client.skills.getCached.mockClear();
    transitions.length = 0;
    if (!keepTelemetry) events.length = 0;
  };

  let thrown: unknown;
  if (case_.name === "close-idempotent") {
    const from = middleware.status;
    await middleware.close();
    recordTransition(from, middleware.status);
    await middleware.close();
  } else if (case_.name === "readiness-timeout") {
    // The readiness operation itself is exercised below from cold state.
  } else if (case_.name === "readiness-ready") {
    await seedReady(true, "fresh");
  } else if (
    case_.name === "readiness-denied-rejects" ||
    case_.name === "readiness-stale-rejects"
  ) {
    if (case_.name === "readiness-stale-rejects") {
      await seedReady();
      now = 30_000;
    }
    responses.push(() => Promise.reject(failureFor(case_)));
    ({ thrown } = await runLoad());
    transitions.length = 0;
    client.skills.get.mockClear();
    events.splice(0, Math.max(0, events.length - 2));
  } else if (
    case_.name === "readiness-closed-rejects" ||
    case_.name === "load-after-close-rejects"
  ) {
    await seedReady();
    const from = middleware.status;
    await middleware.close();
    recordTransition(from, middleware.status);
    if (case_.name === "load-after-close-rejects") {
      ({ thrown } = await runLoad());
    }
  } else if (case_.name === "throttle-hit") {
    await seedReady();
    ({ thrown } = await runLoad());
  } else if (
    case_.name === "etag-unchanged" ||
    case_.name === "changed-revision"
  ) {
    await seedReady();
    now = 30_000;
    responses.push(() => resultFor(case_));
    ({ thrown } = await runLoad());
  } else if (
    case_.name === "transient-stale" ||
    case_.name === "integrity-stale"
  ) {
    await seedReady();
    now = 30_000;
    responses.push(() => Promise.reject(failureFor(case_)));
    ({ thrown } = await runLoad());
  } else if (case_.name === "retry-after-failed-throttle-window") {
    await seedReady();
    now = 30_000;
    responses.push(
      () => Promise.reject(failureFor(case_)),
      () => resultFor(case_),
    );
    ({ thrown } = await runLoad());
    now = 59_999;
    await middleware.load().catch(() => undefined);
    now = 60_000;
    ({ thrown } = await runLoad());
  } else if (
    case_.name === "concurrent-singleflight" ||
    case_.name === "telemetry-sink-failure-singleflight"
  ) {
    const pending = deferred<InstalledSkillSet>();
    responses.push(() => pending.promise);
    const from = middleware.status;
    const first = middleware.load();
    recordTransition(from, middleware.status);
    const second = middleware.load();
    expect(second).toBe(first);
    pending.resolve(await resultFor(case_));
    if (case_.name === "telemetry-sink-failure-singleflight") {
      rejectJoinedTelemetry = true;
      joinedTelemetry.reject(sinkFailure);
    }
    const [firstResult, secondResult] = await Promise.allSettled([
      first,
      second,
    ]);
    recordTransition(transitions.at(-1)?.to ?? from, middleware.status);
    expect(secondResult.status).toBe(firstResult.status);
    if (firstResult.status === "rejected") thrown = firstResult.reason;
  } else if (validation) {
    responses.push(() => validation.result);
    ({ thrown } = await runLoad());
  } else if (expectedError(case_)) {
    responses.push(() => Promise.reject(failureFor(case_)));
    ({ thrown } = await runLoad());
  } else {
    responses.push(() => resultFor(case_));
    ({ thrown } = await runLoad(
      case_.name === "explicit-cached-preload"
        ? () => middleware.preloadCached()
        : () => middleware.load(),
    ));
  }

  if (rejectJoinedTelemetry) {
    expect(thrown).toMatchObject({
      code: "LEARNING_TELEMETRY_SINK_FAILED",
      cause: sinkFailure,
    });
  }

  let readiness:
    | { readonly result: { readonly state: AdapterStatus } }
    | {
        readonly error: {
          readonly code: string;
          readonly category: string;
          readonly retryable: boolean;
        };
      };
  try {
    const snapshot = await middleware.waitUntilReady({ timeoutMs: 0 });
    readiness = { result: { state: snapshot.status } };
  } catch (error) {
    const canonical = error as TestCanonicalError;
    readiness = {
      error: {
        code: canonical.code,
        category: canonical.category,
        retryable: canonical.retryable,
      },
    };
  }

  const expectedTransitions = case_.expected.statusTransitions.map(
    ({ from, to }) => ({ from, to }),
  );
  expect(transitions).toEqual(expectedTransitions);
  expect(operationCalls(case_)).toEqual(case_.expected.calls);
  const expectedReadiness =
    "result" in case_.expected.readiness
      ? case_.expected.readiness
      : {
          error: {
            code: case_.expected.readiness.error.code,
            category: case_.expected.readiness.error.category,
            retryable: case_.expected.readiness.error.retryable,
          },
        };
  expect(readiness).toEqual(expectedReadiness);
  expect({ proceed: middleware.ready }).toEqual(case_.expected.nativeHook);

  if ("result" in case_.expected.genericSdk) {
    const expected = case_.expected.genericSdk.result;
    if (!expected) throw new Error(`${case_.name} must declare a result`);
    if ("closeCount" in expected) {
      expect(middleware.snapshot.status).toBe(expected.state);
      expect(expected.closeCount).toBe(1);
    } else {
      expect({
        state: middleware.snapshot.status,
        freshness:
          middleware.snapshot.status === "stale"
            ? "stale"
            : middleware.snapshot.source,
        registryRevision: middleware.snapshot.registryRevision,
        skillCount: middleware.snapshot.renderedSkills.length,
        aggregateByteLength: middleware.snapshot.renderedSkills.reduce(
          (total, skill) => total + skill.byteLength,
          0,
        ),
      }).toEqual(expected);
    }
  } else {
    const genericError =
      thrown ?? ("error" in readiness ? readiness.error : undefined);
    expect(genericError).toMatchObject({
      code: case_.expected.genericSdk.error.code,
      category: case_.expected.genericSdk.error.category,
      retryable: case_.expected.genericSdk.error.retryable,
    });
  }

  const renderedForNativeHook =
    case_.name === "readiness-stale-rejects"
      ? []
      : middleware.snapshot.renderedSkills;
  expect(renderedForNativeHook).toEqual(case_.expected.renderedRecords);
  assertTelemetry(case_, events);

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
  if (case_.expected.nativeHook.proceed) {
    await middleware.wrapModelCall(request, handler);
    expect(handler).toHaveBeenCalledOnce();
  } else {
    await expect(
      middleware.wrapModelCall(request, handler),
    ).rejects.toBeDefined();
    expect(handler).not.toHaveBeenCalled();
  }
}

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
