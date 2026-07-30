import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Browser } from "playwright";
import type { D5Script } from "./helpers/d5-registry.js";
import type { FrontendMatrixCell } from "./frontend-matrix.js";

const mocks = vi.hoisted(() => ({
  releaseConversation: undefined as (() => void) | undefined,
  conversationSettled: false,
}));

vi.mock("./helpers/conversation-runner.js", () => ({
  runConversation: vi.fn(
    () =>
      new Promise((resolve) => {
        mocks.releaseConversation = () => {
          mocks.conversationSettled = true;
          resolve({
            turns_completed: 1,
            total_turns: 1,
            turn_durations_ms: [1],
          });
        };
      }),
  ),
}));

vi.mock("./helpers/init-scripts.js", () => ({
  installBrowserContextShims: vi.fn(async () => undefined),
  installPrePaintFromEnv: vi.fn(async () => undefined),
}));

vi.mock("./helpers/sse-interceptor.js", () => ({
  attachSseInterceptor: vi.fn(async () => ({
    consumed: false,
    stop: vi.fn(async () => {
      throw new Error("the timed-out page is already closed");
    }),
  })),
}));

import { createPlaywrightProbeExecutor } from "./frontend-matrix-playwright.js";

const CELL: FrontendMatrixCell = {
  id: "angular/spring-ai/voice",
  frontend: "angular",
  integration: "spring-ai",
  feature: "voice",
  featureTypes: ["voice"],
};

describe("frontend matrix Playwright timeout cleanup", () => {
  beforeEach(() => {
    mocks.releaseConversation = undefined;
    mocks.conversationSettled = false;
  });

  it("waits for the interrupted conversation task before returning", async () => {
    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => ({ ok: () => true })),
      waitForFunction: vi.fn(async () => undefined),
    };
    const close = vi.fn(async () => {
      setTimeout(() => mocks.releaseConversation?.(), 20);
    });
    const browser = {
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => page),
        close,
      })),
    } as unknown as Browser;
    const script: D5Script = {
      featureTypes: ["voice"],
      buildTurns: () => [{ input: "hello" }],
    };
    const execute = createPlaywrightProbeExecutor({
      browser,
      scripts: new Map([["voice", script]]),
      probeTimeoutMs: 10,
    });

    const result = await execute({
      cell: CELL,
      featureType: "voice",
      url: "http://127.0.0.1:3116/angular/voice",
      backendUrl: "http://127.0.0.1:3116",
      testId: "timeout-cleanup",
    });

    expect(result.status).toBe("failed");
    expect(mocks.conversationSettled).toBe(true);
    expect(close).toHaveBeenCalled();
  });
});
