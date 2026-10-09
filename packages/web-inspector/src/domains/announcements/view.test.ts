import { nothing, render } from "lit";
import { describe, expect, it } from "vitest";

import type { AnnouncementReady } from "./feed.js";
import { announcementLinkFromClick, renderAnnouncementsView } from "./view.js";

function announcement(publishedAt: string): AnnouncementReady {
  return {
    id: "16f7d877-49e3-41c3-9ca6-f951d3d8ba80",
    title: "Update",
    publishedAt,
    documentHtml: "<p>Update</p>",
    preview: { title: "Update", text: "Update" },
  };
}

function renderView(
  notices: AnnouncementReady[],
  selected: AnnouncementReady | null,
  state: "loading" | "empty" | "content",
) {
  const container = document.createElement("div");
  render(
    renderAnnouncementsView({
      notices,
      selected,
      state,
      pending: state === "loading",
      isRead: () => false,
      onSelect: () => {},
      onBack: () => {},
      contentClick: () => {},
      renderIcon: () => nothing,
    }),
    container,
  );
  return container;
}

describe("renderAnnouncementsView", () => {
  it("preserves the loading state until the feed settles", () => {
    const container = renderView([], null, "loading");

    expect(
      container
        .querySelector("[data-cpk-whats-new]")
        ?.getAttribute("data-cpk-whats-new-state"),
    ).toBe("loading");
    expect(container.textContent).toContain("Loading updates");
  });

  it("lists eligible notices with their unread state", () => {
    const container = renderView(
      [announcement("2026-08-01T00:00:00.000Z")],
      null,
      "content",
    );

    expect(
      container
        .querySelector(".cpk-notification-row time")
        ?.getAttribute("datetime"),
    ).toBe("2026-08-01T00:00:00.000Z");
    expect(container.querySelector(".cpk-notification-unread")).not.toBeNull();
  });

  it("renders the selected notice as an article", () => {
    const notice = announcement("2026-08-01T00:00:00.000Z");
    const container = renderView([notice], notice, "content");

    expect(
      container.querySelector(".inspector-whats-new-document h1")?.textContent,
    ).toBe("Update");
    expect(
      container.querySelector(".announcement-content")?.innerHTML,
    ).toContain("<p>Update</p>");
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
