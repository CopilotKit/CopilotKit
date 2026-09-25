import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  action: vi.fn(),
  featurePrompt: vi.fn(),
  prompt: vi.fn(),
  story: vi.fn(),
  viewed: vi.fn(),
}));

vi.mock("../../shared/telemetry/privacy.js", () => ({
  trackHomeCtaClicked: telemetry.action,
  trackHomeFeaturePromptClicked: telemetry.featurePrompt,
  trackHomePromptCopied: telemetry.prompt,
  trackHomeStoryBeatSelected: telemetry.story,
  trackHomeViewed: telemetry.viewed,
}));

import { INTELLIGENCE_STORY_BEATS } from "./intelligence-state.js";
import {
  trackHomeAction,
  trackHomeFeaturePrompt,
  trackHomePromptCopy,
  trackHomeStorySelection,
  trackHomeView,
} from "./telemetry.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Home telemetry", () => {
  it("preserves the Home event calls", () => {
    trackHomeView(false);
    trackHomeAction(
      {
        kind: "manage_plan",
        url: "https://cloud.copilotkit.ai/settings/billing",
        label: "Manage plan",
      },
      false,
    );
    trackHomeFeaturePrompt("a2ui", "run_12345678", false);
    trackHomePromptCopy("run-1", "copied", false);
    trackHomeStorySelection(INTELLIGENCE_STORY_BEATS[2], 2, false);

    expect(telemetry.viewed).toHaveBeenCalledOnce();
    expect(telemetry.action).toHaveBeenCalledWith({
      action_kind: "manage_plan",
    });
    expect(telemetry.featurePrompt).toHaveBeenCalledWith({
      feature_id: "a2ui",
      onboarding_run_id: "run_12345678",
    });
    expect(telemetry.prompt).toHaveBeenCalledWith({
      onboarding_run_id: "run-1",
      outcome: "copied",
    });
    expect(telemetry.story).toHaveBeenCalledWith({
      beat: "skill",
      beat_index: 2,
    });
  });

  it("does not emit after telemetry opt-out", () => {
    trackHomeView(true);
    trackHomeAction(
      {
        kind: "renew",
        url: "https://cloud.copilotkit.ai/settings/billing",
        label: "Renew plan",
      },
      true,
    );
    trackHomeFeaturePrompt("a2ui", "run_12345678", true);
    trackHomePromptCopy("run-1", "failed", true);
    trackHomeStorySelection(INTELLIGENCE_STORY_BEATS[1], 1, true);

    expect(telemetry.viewed).not.toHaveBeenCalled();
    expect(telemetry.action).not.toHaveBeenCalled();
    expect(telemetry.featurePrompt).not.toHaveBeenCalled();
    expect(telemetry.prompt).not.toHaveBeenCalled();
    expect(telemetry.story).not.toHaveBeenCalled();
  });
});
