import { afterEach, expect, test, vi } from "vitest";
import {
  loadNotificationState,
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
});
test("keeps selection, read and suppression separate across reloads", () => {
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
  localStorage.clear();
  expect(loadNotificationState()).toEqual(state);
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
test("oversized history falls back without leaving a stale cookie", () => {
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
  expect(document.cookie).not.toContain("cpk_inspector_notifications_v1=");
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
