import {
  CopilotKitIntelligence,
  LearnedSkillsError,
} from "@copilotkit/runtime/v2";
import type { LearnedSkillsErrorCode } from "@copilotkit/runtime/v2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lifecycle from "../../conformance/lifecycle.v1.json";
import snapshots from "../../conformance/snapshots.v1.json";
import { SkillRegistry } from "../registry.js";

interface Step {
  advanceMs?: number;
  reply?: {
    snapshot?: string;
    unchanged?: string;
    error?: string;
    retryable?: boolean;
  };
  expect: {
    revision?: string;
    error?: string;
    requests: number;
    initialized?: boolean;
    stale?: boolean;
    lastCheckedAt?: string;
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(lifecycle.initialTimeMs);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("language-neutral lifecycle conformance", () => {
  for (const scenario of lifecycle.cases) {
    it(scenario.name, async () => {
      const client = new CopilotKitIntelligence({ apiKey: "conformance-key" });
      const fetch = vi.spyOn(client, "getLearnedSkillsSnapshot");
      const registry = new SkillRegistry({
        client,
        containerId: "conformance",
        ...scenario.config,
      });
      for (const step of scenario.steps as Step[]) {
        if (step.advanceMs !== undefined)
          await vi.advanceTimersByTimeAsync(step.advanceMs);
        const reply = step.reply;
        if (reply?.error)
          fetch.mockRejectedValueOnce(
            new LearnedSkillsError(
              reply.error as LearnedSkillsErrorCode,
              reply.retryable ?? false,
            ),
          );
        else if (reply) {
          const fixture = snapshots.cases.find(
            (item) => item.name === (reply.snapshot ?? reply.unchanged),
          )!;
          fetch.mockResolvedValueOnce(
            reply.unchanged
              ? {
                  status: "unchanged",
                  revision: fixture.revision,
                  etag: fixture.etag,
                }
              : {
                  status: "snapshot",
                  bytes: new Uint8Array(
                    Buffer.from(fixture.archiveBase64, "base64"),
                  ),
                  revision: fixture.revision,
                  etag: fixture.etag,
                  contentType: "application/zip",
                },
          );
        }
        if (step.expect.error)
          await expect(registry.acquireSnapshot()).rejects.toMatchObject({
            code: step.expect.error,
          });
        else
          expect((await registry.acquireSnapshot()).revision).toBe(
            step.expect.revision,
          );
        expect(fetch).toHaveBeenCalledTimes(step.expect.requests);
        const { requests: _requests, error: _error, ...status } = step.expect;
        expect(registry.status).toMatchObject(status);
        if (scenario.config?.revision) {
          for (const call of fetch.mock.calls)
            expect(call[0].revision).toBe(scenario.config.revision);
        }
      }
    });
  }
});
