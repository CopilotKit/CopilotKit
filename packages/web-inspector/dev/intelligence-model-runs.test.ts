import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

test.each([
  {
    model: "customer-model",
    agentId: "support",
    outcome: "success",
    ids: ["fixture-run-1", "fixture-run-3"],
  },
  {
    model: "customer-model",
    agentId: "billing",
    outcome: "error",
    ids: ["fixture-run-2"],
  },
  {
    model: "customer-model-fast",
    agentId: "support",
    outcome: "success",
    ids: [],
  },
])(
  "model run drilldowns retain $model, $agentId, and $outcome filters",
  ({ model, agentId, outcome, ids }) => {
    const response = intelligenceFixture({
      method: "GET",
      path: "/api/v1/runs",
      query: { model, agentId, outcome, asOf: "fixture_v1" },
    });
    const body = response.body;
    if (
      typeof body !== "object" ||
      body === null ||
      !("data" in body) ||
      !Array.isArray(body.data)
    ) {
      throw new Error("Missing run rows");
    }

    expect(body.data.map((row: Record<string, unknown>) => row.runId)).toEqual(
      ids,
    );
  },
);
