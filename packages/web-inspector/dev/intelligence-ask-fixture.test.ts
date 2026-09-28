import { expect, test } from "vitest";
import { intelligenceAskFixture } from "./intelligence-ask-fixture.js";

test("Ask workbench can group runs by recorded model and outcome", () => {
  const response = intelligenceAskFixture({
    method: "POST",
    path: "/ask",
    body: {
      question: "Runs by model and outcome",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
    },
  });

  expect(response).toMatchObject({
    version: 1,
    results: [
      {
        query: {
          metric: "runs",
          dimensions: ["model", "outcome"],
          filters: {},
        },
        data: {
          metric: "runs",
          total: 3,
          series: [
            {
              dimensions: { model: "customer-model", outcome: "success" },
              total: 1,
            },
            {
              dimensions: { model: "customer-model", outcome: "error" },
              total: 1,
            },
            { dimensions: { model: null, outcome: "success" }, total: 1 },
          ],
        },
      },
    ],
  });
});

test("Ask workbench run groups honor the selected agent", () => {
  const response = intelligenceAskFixture({
    method: "POST",
    path: "/ask",
    body: {
      question: "Runs by model and outcome",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
      agentId: "support",
    },
  });

  expect(response).toMatchObject({
    results: [
      {
        query: { filters: { agentId: "support" } },
        data: {
          total: 2,
          series: [
            {
              dimensions: { model: "customer-model", outcome: "success" },
              total: 1,
            },
            { dimensions: { model: null, outcome: "success" }, total: 1 },
          ],
        },
      },
    ],
  });
});
