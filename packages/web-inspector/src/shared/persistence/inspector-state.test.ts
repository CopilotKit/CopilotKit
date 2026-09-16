import { afterEach, expect, test, vi } from "vitest";

import {
  clearInspectorDismissal,
  INSPECTOR_DISMISSAL_COOKIE_NAME,
  INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  INSPECTOR_DISMISSAL_MIRROR_KEY,
  loadInspectorDismissedUntil,
  loadInspectorState,
  saveInspectorDismissedUntil,
} from "./inspector-state.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-01T19:00:00.000Z");
const LEGACY_STATE_KEY = "cpk-test-inspector-state";

afterEach(() => {
  vi.restoreAllMocks();
  clearInspectorDismissal();
  document.cookie = `${LEGACY_STATE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  window.localStorage.clear();
  vi.useRealTimers();
});

test("falls back to legacy state when localStorage access is blocked", () => {
  document.cookie = `${LEGACY_STATE_KEY}=${encodeURIComponent(
    JSON.stringify({ selectedMenu: "threads" }),
  )}; Path=/; SameSite=Lax`;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage is blocked", "SecurityError");
  });

  expect(loadInspectorState(LEGACY_STATE_KEY)).toEqual({
    selectedMenu: "threads",
  });
});

test("persists an Inspector dismissal across localhost ports", () => {
  const until = NOW + DAY_MS;
  saveInspectorDismissedUntil(until, NOW);

  expect(loadInspectorDismissedUntil(NOW)).toBe(until);
  expect(
    JSON.parse(
      window.localStorage.getItem(INSPECTOR_DISMISSAL_MIRROR_KEY) ?? "null",
    ),
  ).toEqual({ until });
  expect(document.cookie).toContain(`${INSPECTOR_DISMISSAL_COOKIE_NAME}=`);

  window.localStorage.clear();
  expect(loadInspectorDismissedUntil(NOW)).toBe(until);
});

test("expires the dismissal and removes its fallback state", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const until = NOW + DAY_MS;
  saveInspectorDismissedUntil(until);

  vi.setSystemTime(until + 1);
  expect(loadInspectorDismissedUntil()).toBeNull();
  expect(
    window.localStorage.getItem(INSPECTOR_DISMISSAL_MIRROR_KEY),
  ).toBeNull();
  expect(document.cookie).not.toContain(`${INSPECTOR_DISMISSAL_COOKIE_NAME}=`);
});

test("limits Inspector dismissals to the supported one-week duration", () => {
  const requestedUntil = NOW + INSPECTOR_DISMISSAL_MAX_DURATION_MS * 2;
  const maximumUntil = NOW + INSPECTOR_DISMISSAL_MAX_DURATION_MS;
  saveInspectorDismissedUntil(requestedUntil, NOW);

  expect(loadInspectorDismissedUntil(NOW)).toBe(maximumUntil);
  expect(
    JSON.parse(
      window.localStorage.getItem(INSPECTOR_DISMISSAL_MIRROR_KEY) ?? "null",
    ),
  ).toEqual({ until: maximumUntil });

  window.localStorage.clear();
  expect(loadInspectorDismissedUntil(NOW)).toBe(maximumUntil);
});

test("bounds an untrusted host cookie and rewrites both persistence layers", () => {
  const requestedUntil = NOW + INSPECTOR_DISMISSAL_MAX_DURATION_MS * 2;
  const maximumUntil = NOW + INSPECTOR_DISMISSAL_MAX_DURATION_MS;
  document.cookie = `${INSPECTOR_DISMISSAL_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ until: requestedUntil }),
  )}; Path=/; SameSite=Lax`;

  expect(loadInspectorDismissedUntil(NOW)).toBe(maximumUntil);
  expect(
    JSON.parse(
      window.localStorage.getItem(INSPECTOR_DISMISSAL_MIRROR_KEY) ?? "null",
    ),
  ).toEqual({ until: maximumUntil });

  window.localStorage.clear();
  expect(loadInspectorDismissedUntil(NOW)).toBe(maximumUntil);
});
