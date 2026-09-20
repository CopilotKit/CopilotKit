import { selectedObservationFingerprint } from "./selected-observation.js";
import { describe, expect, it } from "vitest";
import { createStatusWriter } from "./status-writer.js";
import { createPbClient } from "../storage/pb-client.js";
import { createEventBus } from "../events/event-bus.js";
import { logger } from "../logger.js";

describe("selected observation persistence", () => {
  it("fails before any ordinary write when its authoritative job is missing", async () => {
    const requests: string[] = [];
    const pb = createPbClient({
      url: "http://pb.test",
      logger,
      fetchImpl: async (input) => {
        requests.push(String(input));
        return new Response("{}", { status: 404 });
      },
    });
    const writer = createStatusWriter({ pb, bus: createEventBus(), logger });
    await expect(
      writer.writeSelected({
        jobId: "missing-job",
        result: {
          key: "d5:service/feature",
          state: "red",
          signal: {},
          observedAt: "2026-09-17T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/job/);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/probe_jobs/records/missing-job");
  });
});

it("does not read or rewrite current status when the job already has a receipt", async () => {
  const observation = {
    jobId: "existing-job",
    result: {
      key: "d5:service/feature",
      state: "red" as const,
      signal: {},
      observedAt: "2026-09-17T00:00:00.000Z",
    },
  };
  const outcome = {
    kind: "write" as const,
    value: {
      previousState: "green" as const,
      newState: "red" as const,
      transition: "green_to_red" as const,
      firstFailureAt: observation.result.observedAt,
      failCount: 1,
      persisted: true,
    },
  };
  const requests: string[] = [];
  const pb = createPbClient({
    url: "http://pb.test",
    logger,
    fetchImpl: async (input) => {
      requests.push(String(input));
      return Response.json({
        result_observation_receipts: {
          [observation.result.key]: {
            fingerprint: selectedObservationFingerprint({
              result: observation.result,
            }),
            route: "write",
            outcome,
          },
        },
      });
    },
  });
  const bus = createEventBus();
  const events: unknown[] = [];
  bus.on("status.changed", (event) => {
    events.push(event);
  });
  const writer = createStatusWriter({ pb, bus, logger });
  expect(await writer.writeSelected(observation)).toEqual(outcome);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("/probe_jobs/records/existing-job");
  expect(events).toEqual([]);
});

it("rejects a reused observation identity with changed input", async () => {
  const pb = createPbClient({
    url: "http://pb.test",
    logger,
    fetchImpl: async () =>
      Response.json({
        result_observation_receipts: {
          "d5:service/feature": { fingerprint: "different-logical-input" },
        },
      }),
  });
  const writer = createStatusWriter({ pb, bus: createEventBus(), logger });
  await expect(
    writer.writeSelected({
      jobId: "existing-job",
      result: {
        key: "d5:service/feature",
        state: "red",
        signal: {},
        observedAt: "2026-09-17T00:00:00Z",
      },
    }),
  ).rejects.toThrow("identity_conflict");
});
