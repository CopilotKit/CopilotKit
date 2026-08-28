import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  action: vi.fn(),
  featurePrompt: vi.fn(),
  viewed: vi.fn(),
}));

vi.mock("../../shared/telemetry/privacy.js", () => ({
  trackHomeCtaClicked: telemetry.action,
  trackHomeFeaturePromptClicked: telemetry.featurePrompt,
  trackHomeViewed: telemetry.viewed,
}));

import {
  trackHomeAction,
  trackHomeFeaturePrompt,
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

    expect(telemetry.viewed).toHaveBeenCalledOnce();
    expect(telemetry.action).toHaveBeenCalledWith({
      action_kind: "manage_plan",
    });
    expect(telemetry.featurePrompt).toHaveBeenCalledWith({
      feature_id: "a2ui",
      onboarding_run_id: "run_12345678",
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

    expect(telemetry.viewed).not.toHaveBeenCalled();
    expect(telemetry.action).not.toHaveBeenCalled();
    expect(telemetry.featurePrompt).not.toHaveBeenCalled();
  });
});
