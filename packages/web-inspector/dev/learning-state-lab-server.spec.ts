import { describe, expect, it } from "vitest";
import { LEARNING_LAB_BASE_PATH } from "./learning-state-fixtures.js";
import { handleLearningStateLabRequest } from "./learning-state-lab-server.js";

describe("integrated Inspector Learning state lab runtime", () => {
  it("negotiates the capability and serves paginated snapshots over REST", async () => {
    const base = `http://127.0.0.1:5177${LEARNING_LAB_BASE_PATH}/multiple-skills`;
    const info = await handleLearningStateLabRequest(
      new Request(`${base}/info`),
    );
    expect(await info?.json()).toMatchObject({
      inspectorLearning: true,
      intelligence: { wsUrl: expect.stringMatching(/^ws:/) },
      agents: { "Checkout Assistant": { name: "Checkout Assistant" } },
    });

    const response = await handleLearningStateLabRequest(
      new Request(`${base}/inspector-learning?skillsPage=2&insightsPage=1`),
    );
    expect(await response?.json()).toMatchObject({
      skillsPage: { page: 2, pageSize: 3, total: 6 },
      insightsPage: { page: 1, pageSize: 4, total: 2 },
    });
  });

  it("serves the same snapshot through the real single-route envelope", async () => {
    const response = await handleLearningStateLabRequest(
      new Request(`http://127.0.0.1:5177${LEARNING_LAB_BASE_PATH}/success`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "inspector/learning",
          params: { skillsPage: "1", insightsPage: "2" },
        }),
      }),
    );
    expect(await response?.json()).toMatchObject({
      projectKey: "checkout-assistant-project",
      skillsPage: { page: 1, pageSize: 3 },
      insightsPage: { page: 2, pageSize: 4, total: 7 },
      links: {
        learning:
          "https://app.copilotkit.ai/learning?container=checkout-assistant-default",
        candidates:
          "https://app.copilotkit.ai/o/acme/checkout/learning/checkout-assistant-default/skills",
        runs: "https://app.copilotkit.ai/learning?container=checkout-assistant-default&tab=runs",
      },
    });
  });

  it("keeps unsupported and data-error states distinct", async () => {
    const unsupportedBase = `http://127.0.0.1:5177${LEARNING_LAB_BASE_PATH}/unsupported`;
    const info = await handleLearningStateLabRequest(
      new Request(`${unsupportedBase}/info`),
    );
    expect(await info?.json()).not.toHaveProperty("inspectorLearning");

    const unavailable = await handleLearningStateLabRequest(
      new Request(
        `http://127.0.0.1:5177${LEARNING_LAB_BASE_PATH}/data-error/inspector-learning`,
      ),
    );
    expect(unavailable?.status).toBe(503);
  });
});
