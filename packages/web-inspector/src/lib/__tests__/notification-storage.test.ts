import { afterEach, expect, test, vi } from "vitest";
import {
  loadNotificationState,
  migrateAnnouncementReadState,
  hasNotificationPulsed,
  saveNotificationPulsedId,
  saveNotificationState,
} from "../persistence.js";
import { emptyNotificationState } from "../notifications.js";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "cpk_inspector_notifications_v1=; Max-Age=0; Path=/";
  document.cookie = "cpk_inspector_announcements=; Max-Age=0; Path=/";
});
test("keeps selection per origin and acknowledgements across ports", () => {
  const state = {
    ...emptyNotificationState(),
    activeId: "d9c32a88-51ae-5b9b-8613-1dc3d413eebd",
    eligibleIds: [
      "d9c32a88-51ae-5b9b-8613-1dc3d413eebd",
      "7288f45f-956f-5e34-ba13-5a375a2f4d78",
    ],
    readIds: ["2f13d1be-51d0-5b3d-b9a1-3fcc6b088122"],
    suppressedIds: ["7288f45f-956f-5e34-ba13-5a375a2f4d78"],
  };
  saveNotificationState(state);
  expect(loadNotificationState()).toEqual(state);
  localStorage.clear();
  expect(loadNotificationState()).toEqual({
    ...emptyNotificationState(),
    readIds: state.readIds,
    suppressedIds: state.suppressedIds,
  });
  const cookie = decodeURIComponent(document.cookie.split("=")[1] ?? "");
  expect(cookie).not.toContain("eligibleIds");
  expect(cookie).not.toContain("activeId");
});
test("merges host acknowledgements with origin state", () => {
  const originRead = "2f13d1be-51d0-5b3d-b9a1-3fcc6b088122";
  const hostRead = "7288f45f-956f-5e34-ba13-5a375a2f4d78";
  const selected = "d9c32a88-51ae-5b9b-8613-1dc3d413eebd";
  localStorage.setItem(
    "cpk:inspector:notifications:v1",
    JSON.stringify({
      ...emptyNotificationState(),
      eligibleIds: [selected],
      activeId: selected,
      readIds: [originRead],
    }),
  );
  document.cookie = `cpk_inspector_notifications_v1=${encodeURIComponent(
    JSON.stringify({
      schemaVersion: 1,
      readIds: [hostRead],
      suppressedIds: [hostRead],
    }),
  )}; Path=/`;
  expect(loadNotificationState()).toEqual({
    ...emptyNotificationState(),
    eligibleIds: [selected],
    activeId: selected,
    readIds: [originRead, hostRead],
    suppressedIds: [hostRead],
  });
});
test("reads acknowledgements from an older full-state cookie", () => {
  const readId = "2f13d1be-51d0-5b3d-b9a1-3fcc6b088122";
  const foreignSelection = "d9c32a88-51ae-5b9b-8613-1dc3d413eebd";
  document.cookie = `cpk_inspector_notifications_v1=${encodeURIComponent(
    JSON.stringify({
      ...emptyNotificationState(),
      activeId: foreignSelection,
      eligibleIds: [foreignSelection],
      readIds: [readId],
    }),
  )}; Path=/`;
  expect(loadNotificationState()).toEqual({
    ...emptyNotificationState(),
    readIds: [readId],
  });
  saveNotificationState(emptyNotificationState());
  expect(loadNotificationState().readIds).toEqual([readId]);
  expect(decodeURIComponent(document.cookie)).not.toContain("eligibleIds");
});
test("uses localStorage when cookies are unavailable, and tolerates both failing", () => {
  vi.spyOn(document, "cookie", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(document, "cookie", "set").mockImplementation(() => {
    throw new Error("blocked");
  });
  const state = {
    ...emptyNotificationState(),
    readIds: ["2f13d1be-51d0-5b3d-b9a1-3fcc6b088122"],
  };
  expect(() => saveNotificationState(state)).not.toThrow();
  expect(loadNotificationState()).toEqual(state);
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => saveNotificationState(state)).not.toThrow();
  expect(loadNotificationState()).toEqual(emptyNotificationState());
});
test("oversized history keeps a bounded host cookie and full origin history", () => {
  saveNotificationState(emptyNotificationState());
  const state = {
    ...emptyNotificationState(),
    readIds: Array.from(
      { length: 300 },
      (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
    ),
  };
  saveNotificationState(state);
  expect(loadNotificationState()).toEqual(state);
  const cookie = decodeURIComponent(document.cookie.split("=")[1] ?? "");
  expect(cookie).toContain(state.readIds.at(-1));
  expect(cookie).not.toContain(state.readIds[0]);
  expect(encodeURIComponent(cookie).length).toBeLessThan(1024);
});

test("migrates legacy pulse timestamps once without conflating new IDs with equal dates", () => {
  const date = "2026-09-08T12:00:00.000Z";
  sessionStorage.setItem("cpk:inspector:pulsed", date);
  expect(
    hasNotificationPulsed("2956558f-8f72-5bd1-b5c6-529500f00f1c", date),
  ).toBe(true);
  expect(
    hasNotificationPulsed("6cd254f6-695a-5eef-9e73-7ce89f676476", date),
  ).toBe(false);
  saveNotificationPulsedId("6cd254f6-695a-5eef-9e73-7ce89f676476");
  expect(
    hasNotificationPulsed(
      "6cd254f6-695a-5eef-9e73-7ce89f676476",
      "2026-09-09T12:00:00.000Z",
    ),
  ).toBe(true);
});

test("does not pulse an earlier notification again after another one pulses", () => {
  const first = "2956558f-8f72-5bd1-b5c6-529500f00f1c";
  const second = "6cd254f6-695a-5eef-9e73-7ce89f676476";
  const date = "2026-09-08T12:00:00.000Z";
  saveNotificationPulsedId(first);
  saveNotificationPulsedId(second);
  expect(hasNotificationPulsed(first, date)).toBe(true);
  expect(hasNotificationPulsed(second, date)).toBe(true);
});

test.each(["invalid JSON", "null", '{"timestamp":"unmatched"}'])(
  "leaves new notifications unread for invalid or unmatched legacy state: %s",
  (raw) => {
    localStorage.setItem("cpk:inspector:announcement_read", raw);
    const state = emptyNotificationState();
    expect(
      migrateAnnouncementReadState(state, {
        schemaVersion: 1,
        notifications: [],
      }),
    ).toEqual(state);
  },
);

test.each(["cookie", "localStorage"])(
  "migrates only the legacy announcement when another notice shares its timestamp in %s",
  (storage) => {
    const legacyId = "16f7d877-49e3-41c3-9ca6-f951d3d8ba80";
    const otherId = "e0897224-968b-5a24-b46c-6744c2b2b254";
    const publishedAt = "2026-08-13T13:00:00.000Z";
    const payload = JSON.stringify({ timestamp: publishedAt });
    if (storage === "cookie") {
      document.cookie = `cpk_inspector_announcements=${encodeURIComponent(payload)}; Path=/`;
    } else {
      localStorage.setItem("cpk:inspector:announcement_read", payload);
    }

    const state = migrateAnnouncementReadState(emptyNotificationState(), {
      schemaVersion: 1,
      notifications: [
        {
          id: otherId,
          publishedAt,
          title: "New update",
          body: "",
          audiences: [{}],
          priority: "Low",
        },
        {
          id: legacyId,
          publishedAt,
          title: "Legacy update",
          body: "",
          audiences: [{}],
          priority: "Low",
        },
      ],
    });

    expect(state.readIds).toEqual([legacyId]);
    expect(state.suppressedIds).toEqual([legacyId]);
    expect(state.readIds).not.toContain(otherId);
  },
);
