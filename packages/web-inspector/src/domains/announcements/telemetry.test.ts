import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  clicked: vi.fn(),
  signalViewed: vi.fn(),
  viewed: vi.fn(),
}));

vi.mock("../../shared/telemetry/privacy.js", () => ({
  trackWhatsNewClicked: telemetry.clicked,
  trackWhatsNewSignalViewed: telemetry.signalViewed,
  trackWhatsNewViewed: telemetry.viewed,
}));

import type { AnnouncementReady } from "./feed.js";
import { AnnouncementTelemetry } from "./telemetry.js";

function announcement(timestamp: string): AnnouncementReady {
  return {
    status: "ready",
    timestamp,
    markdown: "Update",
    documentHtml: "<p>Update</p>",
    preview: { title: "Update", text: "Update" },
    shouldArm: true,
    shouldPulse: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnnouncementTelemetry", () => {
  it("waits for the handshake and deduplicates launcher and view events", () => {
    const tracker = new AnnouncementTelemetry();
    const ready = announcement("release-27");
    tracker.recordLauncherPulse(ready, "animated");
    tracker.recordLauncherPulse(ready, "animated");
    tracker.recordView(ready);
    tracker.recordView(ready);
    tracker.flush(false, false);
    expect(telemetry.signalViewed).not.toHaveBeenCalled();
    expect(telemetry.viewed).not.toHaveBeenCalled();

    tracker.flush(true, false);
    expect(telemetry.signalViewed).toHaveBeenCalledTimes(1);
    expect(telemetry.viewed).toHaveBeenCalledTimes(1);
  });

  it("discards pending telemetry after opt-out", () => {
    const tracker = new AnnouncementTelemetry();
    tracker.recordLauncherPulse(announcement("release-27"), "animated");
    tracker.recordView(announcement("release-27"));
    tracker.flush(false, true);
    tracker.flush(true, false);
    expect(telemetry.signalViewed).not.toHaveBeenCalled();
    expect(telemetry.viewed).not.toHaveBeenCalled();
  });

  it("caps the pending view queue at twenty", () => {
    const tracker = new AnnouncementTelemetry();
    for (let index = 0; index < 21; index += 1) {
      tracker.recordView(announcement(`release-${index}`));
    }
    tracker.flush(true, false);
    expect(telemetry.viewed).toHaveBeenCalledTimes(20);
  });

  it("records one body click only after an allowing handshake", () => {
    const tracker = new AnnouncementTelemetry();
    const ready = announcement("release-27");
    tracker.recordBodyClick(ready, false, false);
    tracker.recordBodyClick(ready, true, false);
    tracker.recordBodyClick(ready, true, false);
    expect(telemetry.clicked).toHaveBeenCalledTimes(1);
    expect(telemetry.clicked).toHaveBeenCalledWith({
      banner_id: "release-27",
      cta: "body",
      cta_label: undefined,
    });
  });
});
