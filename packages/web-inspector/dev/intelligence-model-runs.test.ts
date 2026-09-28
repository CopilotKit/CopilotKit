import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

const cases: readonly { query: Record<string, string>; ids: string[] }[] = [
  {
    query: { model: "customer-model", agentId: "support", outcome: "success" },
    ids: ["fixture-run-1"],
  },
  {
    query: { model: "customer-model", agentId: "billing", outcome: "error" },
    ids: ["fixture-run-2"],
  },
  { query: { model: "customer-model-fast", agentId: "support" }, ids: [] },
  {
    query: { modelCapture: "missing", agentId: "support" },
    ids: ["fixture-run-3"],
  },
  {
    query: { modelCapture: "present", agentId: "support" },
    ids: ["fixture-run-1"],
  },
  { query: { modelCapture: "missing", model: "customer-model" }, ids: [] },
];

test.each(cases)("model run filters preserve $query", ({ query, ids }) => {
  const response = intelligenceFixture({
    method: "GET",
    path: "/api/v1/runs",
    query,
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
});
