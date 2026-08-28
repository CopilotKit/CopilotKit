import { render } from "lit";
import { describe, expect, it } from "vitest";

import type { AnnouncementReady } from "./feed.js";
import { renderAnnouncementsView } from "./view.js";

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

function renderView(value: AnnouncementReady | null, loaded: boolean) {
  const container = document.createElement("div");
  render(
    renderAnnouncementsView(value, loaded, () => {}),
    container,
  );
  return container;
}

describe("renderAnnouncementsView", () => {
  it("preserves the loading state until the feed settles", () => {
    const container = renderView(null, false);

    expect(
      container
        .querySelector("[data-cpk-whats-new]")
        ?.getAttribute("data-cpk-whats-new-state"),
    ).toBe("loading");
  });

  it("normalizes a compatible timestamp for the time element", () => {
    const container = renderView(announcement("2026-08-01T00:00:00Z"), true);

    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});
