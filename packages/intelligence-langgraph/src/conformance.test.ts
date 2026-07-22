import { describe, expect, it, vi } from "vitest";
import corpus from "../../intelligence/conformance/registry-adapters-v1.json" with { type: "json" };
import { createSkillRegistryMiddleware } from "./index.js";
import {
  TestCanonicalError,
  deferred,
  installedSkillSet,
  testClient,
} from "../tests/test-utils.js";
import type { InstalledSkillSet } from "@copilotkit/intelligence";

const CONTAINER_ID = "55555555-5555-4555-8555-555555555555";

function middlewareFor(
  get: () => Promise<InstalledSkillSet>,
  options: {
    readonly maximumSkills?: number;
    readonly maximumInstructionBytes?: number;
    readonly maximumAggregateBytes?: number;
    readonly clock?: () => number;
    readonly telemetry?: (event: { readonly name: string }) => void;
  } = {},
) {
  return createSkillRegistryMiddleware({
    client: testClient(get),
    learningContainerId: CONTAINER_ID,
    ...options,
  });
}

function expectedError(case_: (typeof corpus.cases)[number]) {
  return "error" in case_.expected.genericSdk
    ? case_.expected.genericSdk.error
    : undefined;
}

describe.each(corpus.cases)("adapter conformance: $name", (case_) => {
  it("executes the declared lifecycle outcome", async () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.contractVersion).toBe("registry-adapters-v1");
    expect(case_.expected.statusTransitions).toBeInstanceOf(Array);
    expect(case_.expected.telemetryNames).toBeInstanceOf(Array);

    if (
      case_.name === "close-idempotent" ||
      case_.name === "load-after-close-rejects" ||
      case_.name === "readiness-closed-rejects"
    ) {
      const middleware = middlewareFor(() => installedSkillSet());
      await middleware.close();
      await middleware.close();
      await expect(middleware.load()).rejects.toMatchObject({
        code: "LEARNING_REGISTRY_CLOSED",
      });
      await expect(
        middleware.waitUntilReady({ timeoutMs: 1 }),
      ).rejects.toMatchObject({ code: "LEARNING_REGISTRY_CLOSED" });
      return;
    }

    if (case_.name === "readiness-timeout") {
      const middleware = middlewareFor(() => installedSkillSet());
      await expect(
        middleware.waitUntilReady({ timeoutMs: 0 }),
      ).rejects.toMatchObject({
        code: "LEARNING_REGISTRY_READINESS_TIMEOUT",
      });
      return;
    }

    if (
      case_.name === "concurrent-singleflight" ||
      case_.name === "telemetry-sink-failure-singleflight"
    ) {
      const pending = deferred<InstalledSkillSet>();
      const sinkError = new Error("sink-exception-1");
      const client = testClient(() => pending.promise);
      const middleware = createSkillRegistryMiddleware({
        client,
        learningContainerId: CONTAINER_ID,
        telemetry:
          case_.name === "telemetry-sink-failure-singleflight"
            ? (event) => {
                if (event.name === "load.succeeded") throw sinkError;
              }
            : undefined,
      });
      const first = middleware.load();
      const second = middleware.load();
      pending.resolve(await installedSkillSet());
      const results = await Promise.allSettled([first, second]);
      expect(client.skills.get).toHaveBeenCalledOnce();
      if (case_.name === "telemetry-sink-failure-singleflight") {
        expect(results[0]).toMatchObject({
          status: "rejected",
          reason: sinkError,
        });
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: sinkError,
        });
      } else {
        expect(results.every((result) => result.status === "fulfilled")).toBe(
          true,
        );
      }
      return;
    }

    if (case_.name === "retry-after-failed-throttle-window") {
      let now = 0;
      const failure = new TestCanonicalError({
        code: "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
        category: "availability",
        retryable: true,
      });
      const client = testClient(
        vi
          .fn()
          .mockRejectedValueOnce(failure)
          .mockResolvedValue(await installedSkillSet()),
      );
      const middleware = createSkillRegistryMiddleware({
        client,
        learningContainerId: CONTAINER_ID,
        clock: () => now,
      });
      await expect(middleware.load()).rejects.toBe(failure);
      now = 29_999;
      await expect(middleware.load()).rejects.toMatchObject({
        code: "LEARNING_REGISTRY_STALE",
      });
      now = 30_000;
      await expect(middleware.load()).resolves.toMatchObject({
        status: "ready",
      });
      expect(client.skills.get).toHaveBeenCalledTimes(2);
      return;
    }

    let validation:
      | {
          readonly result: Promise<InstalledSkillSet>;
          readonly options: {
            readonly maximumSkills?: number;
            readonly maximumInstructionBytes?: number;
            readonly maximumAggregateBytes?: number;
          };
        }
      | undefined;
    switch (case_.name) {
      case "too-many-skills":
        validation = {
          result: installedSkillSet({ count: 129 }),
          options: { maximumSkills: 128 },
        };
        break;
      case "skill-md-too-large":
        validation = {
          result: installedSkillSet({ text: "123456789" }),
          options: { maximumInstructionBytes: 8 },
        };
        break;
      case "aggregate-too-large":
        validation = {
          result: installedSkillSet({ count: 2 }),
          options: { maximumAggregateBytes: 15 },
        };
        break;
      case "invalid-utf8":
        validation = {
          result: installedSkillSet({ rawBytes: Uint8Array.from([0xff]) }),
          options: {},
        };
        break;
      case "script-disabled":
        validation = {
          result: installedSkillSet({
            files: [{ path: "scripts/run.sh", role: "script" }],
          }),
          options: {},
        };
        break;
    }
    if (validation) {
      const middleware = middlewareFor(
        () => validation.result,
        validation.options,
      );
      await expect(middleware.load()).rejects.toMatchObject({
        code: expectedError(case_)?.code,
      });
      expect(middleware.status).toBe("denied");
      return;
    }

    if (
      case_.name === "transient-stale" ||
      case_.name === "integrity-stale" ||
      case_.name === "readiness-stale-rejects"
    ) {
      const failure = new TestCanonicalError({
        code:
          case_.name === "integrity-stale"
            ? "LEARNING_BLOB_INTEGRITY_FAILURE"
            : "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
        category:
          case_.name === "integrity-stale" ? "validation" : "availability",
        retryable: case_.name !== "integrity-stale",
      });
      const middleware = middlewareFor(() => Promise.reject(failure));
      await expect(middleware.load()).rejects.toBe(failure);
      expect(middleware.status).toBe("stale");
      await expect(
        middleware.waitUntilReady({ timeoutMs: 1 }),
      ).rejects.toMatchObject({ code: "LEARNING_REGISTRY_STALE" });
      return;
    }

    const error = expectedError(case_);
    if (error) {
      const failure = new TestCanonicalError({
        code: error.code,
        category: error.category,
        retryable: error.retryable,
        ...(error.httpStatus ? { status: error.httpStatus } : {}),
      });
      const middleware = middlewareFor(() => Promise.reject(failure));
      await expect(middleware.load()).rejects.toBe(failure);
      expect(middleware.status).toBe("denied");
      if (case_.name === "readiness-denied-rejects") {
        await expect(middleware.waitUntilReady({ timeoutMs: 1 })).rejects.toBe(
          failure,
        );
      }
      return;
    }

    const revoked = case_.name === "revoked";
    const cached = case_.name === "explicit-cached-preload";
    const result = installedSkillSet({
      revoked,
      freshness: cached ? "cached" : "fresh",
      registryRevision:
        case_.name === "changed-revision" ? "revision-2" : "revision-1",
    });
    const middleware = middlewareFor(() => result);
    const snapshot = cached
      ? await middleware.preloadCached()
      : await middleware.load();
    expect(snapshot.status).toBe(revoked ? "revoked" : "ready");
    expect(snapshot.source).toBe(cached ? "cached" : "fresh");
    expect(snapshot.renderedSkills).toHaveLength(revoked ? 0 : 1);
    await expect(middleware.waitUntilReady({ timeoutMs: 1 })).resolves.toBe(
      snapshot,
    );
  });
});
