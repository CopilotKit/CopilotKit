import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyHomeFeaturePrompt,
  createHomeFeatureSetupState,
  disposeHomeFeatureSetupState,
  homeFeaturePromptCopyState,
} from "./feature-setup.js";

const service = {
  id: "a2ui" as const,
  label: "A2UI",
  docsUrl: "https://docs.copilotkit.ai/generative-ui/a2ui",
};

describe("Home feature setup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("copies a correlated prompt and resets its result", async () => {
    const state = createHomeFeatureSetupState();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const trackClick = vi.fn();
    const requestUpdate = vi.fn();

    await copyHomeFeaturePrompt(state, service, {
      clipboard: { writeText },
      createRunId: () => "run_12345678",
      isConnected: () => true,
      requestUpdate,
      trackClick,
    });

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("--run run_12345678"),
    );
    expect(trackClick).toHaveBeenCalledWith("a2ui", "run_12345678");
    expect(homeFeaturePromptCopyState(state, "a2ui")).toBe("copied");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(homeFeaturePromptCopyState(state, "a2ui")).toBe("idle");
  });

  it("ignores a stale copy result after disposal", async () => {
    const state = createHomeFeatureSetupState();
    let resolveCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );

    const copying = copyHomeFeaturePrompt(state, service, {
      clipboard: { writeText },
      createRunId: () => "run_12345678",
      isConnected: () => true,
      requestUpdate: vi.fn(),
      trackClick: vi.fn(),
    });
    disposeHomeFeatureSetupState(state);
    resolveCopy?.();
    await copying;

    expect(homeFeaturePromptCopyState(state, "a2ui")).toBe("idle");
  });
});
