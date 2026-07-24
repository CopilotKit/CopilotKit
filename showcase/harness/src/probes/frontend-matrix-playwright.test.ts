import { describe, expect, it, vi } from "vitest";

import type { FrontendMatrixCell } from "./frontend-matrix.js";
import {
  conversationFailureSummary,
  createFrontendCellExecutor,
  testIdForFrontendProbe,
  waitForFrameworkHydration,
} from "./frontend-matrix-playwright.js";
import type { FrontendProbeExecutor } from "./frontend-matrix-playwright.js";

const ANGULAR_CELL: FrontendMatrixCell = {
  id: "angular/langgraph-python/beautiful-chat",
  frontend: "angular",
  integration: "langgraph-python",
  feature: "beautiful-chat",
  featureTypes: ["beautiful-chat-toggle-theme", "beautiful-chat-pie-chart"],
};

describe("frontend matrix Playwright execution", () => {
  it("classifies conversation failures without persisting response content", () => {
    expect(
      conversationFailureSummary(
        "timeout: assistant did not settle (reason=text-unstable, runsFinished=2)",
      ),
    ).toBe("settle-text-unstable");
    expect(
      conversationFailureSummary(
        'gen-ui-agent-pill: Observed: ["private generated response"]',
      ),
    ).toBe("rendered-content-mismatch");
    expect(conversationFailureSummary(undefined)).toBe("unknown");
  });

  it("runs every mapped probe once at the exact catalog route", async () => {
    const runProbe = vi.fn<FrontendProbeExecutor>(async (input) => ({
      featureType: input.featureType,
      status:
        input.featureType === "beautiful-chat-toggle-theme"
          ? "failed"
          : "passed",
      durationMs: 4,
      testId: input.testId,
      ...(input.featureType === "beautiful-chat-toggle-theme"
        ? { errorClass: "conversation-error", error: "assertion failed" }
        : {}),
    }));
    const execute = createFrontendCellExecutor({
      angularBaseUrl: "http://127.0.0.1:4300",
      backendUrls: {
        "langgraph-python":
          "https://showcase-langgraph-python-production.up.railway.app",
      },
      invocationId: "run-42",
      runProbe,
    });

    const result = await execute(ANGULAR_CELL);

    expect(runProbe).toHaveBeenCalledTimes(2);
    expect(runProbe.mock.calls.map(([input]) => input.featureType)).toEqual(
      ANGULAR_CELL.featureTypes,
    );
    expect(
      runProbe.mock.calls.every(
        ([input]) =>
          input.url === "http://127.0.0.1:4300/angular/beautiful-chat",
      ),
    ).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.probes).toHaveLength(2);
  });

  it("uses framework-specific hydration contracts", async () => {
    const angularPage = {
      waitForFunction: vi.fn(
        async (
          _expression: string,
          _argument: undefined,
          _options: { timeout: number },
        ) => undefined,
      ),
    };
    const reactPage = {
      waitForFunction: vi.fn(
        async (
          _expression: string,
          _argument: undefined,
          _options: { timeout: number },
        ) => undefined,
      ),
    };

    await waitForFrameworkHydration(angularPage, "angular", 1234);
    await waitForFrameworkHydration(reactPage, "react", 5678);

    expect(angularPage.waitForFunction).toHaveBeenCalledWith(
      expect.stringMatching(/ng-version/),
      undefined,
      { timeout: 1234 },
    );
    expect(angularPage.waitForFunction.mock.calls[0]?.[0]).not.toMatch(
      /textarea|textbox/,
    );
    expect(reactPage.waitForFunction).toHaveBeenCalledWith(
      expect.stringMatching(/querySelectorAll.*__react/s),
      undefined,
      { timeout: 5678 },
    );
  });

  it("creates stable correlation-safe probe IDs", () => {
    const testId = testIdForFrontendProbe(
      ANGULAR_CELL,
      "beautiful-chat-toggle-theme",
      "RUN / 42",
    );

    expect(testId).toBe(
      "fm-angular-langgraph-python-beautiful-chat-beautiful-chat-toggle-theme-run-42",
    );
    expect(testId.length).toBeLessThanOrEqual(160);
  });
});
