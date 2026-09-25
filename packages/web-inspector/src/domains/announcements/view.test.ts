import { render } from "lit";
import { describe, expect, it } from "vitest";

import type { AnnouncementReady } from "./feed.js";
import { announcementLinkFromClick, renderAnnouncementsView } from "./view.js";

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

describe("announcementLinkFromClick", () => {
  it("recognizes a nested link target created in another window realm", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const foreignDocument = iframe.contentDocument;
    if (!foreignDocument) {
      throw new Error("Expected iframe browsing context");
    }

    const link = foreignDocument.createElement("a");
    const target = foreignDocument.createElement("span");
    link.append(target);
    foreignDocument.body.append(link);
    let clickEvent: Event | undefined;
    target.addEventListener("click", (event) => {
      clickEvent = event;
    });
    const dispatchedEvent = foreignDocument.createEvent("Event");
    dispatchedEvent.initEvent("click", true, true);
    target.dispatchEvent(dispatchedEvent);
    if (!clickEvent) throw new Error("Expected click event");

    expect(announcementLinkFromClick(clickEvent)).toBe(link);
    iframe.remove();
  });
});
