import { afterEach, expect, test, vi } from "vitest";

import {
  clearInspectorDismissal,
  INSPECTOR_DISMISSAL_COOKIE_NAME,
  INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  INSPECTOR_DISMISSAL_MIRROR_KEY,
  loadInspectorDismissedUntil,
  saveInspectorDismissedForever,
  saveInspectorDismissedUntil,
} from "../persistence.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-01T19:00:00.000Z");

afterEach(() => {
  clearInspectorDismissal();
  window.localStorage.clear();
  vi.useRealTimers();
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

  // localStorage is partitioned by origin (including port), while the
  // host-scoped cookie survives a localhost:3000 → localhost:5173 switch.
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

test("limits Inspector dismissals to the supported maximum duration", () => {
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

test("renews a forever dismissal on every load instead of expiring", () => {
  saveInspectorDismissedForever(NOW);

  // Long past the original one-year deadline, the dismissal is still active
  // and has been renewed to a full window from the new time.
  const later = NOW + INSPECTOR_DISMISSAL_MAX_DURATION_MS * 3;
  expect(loadInspectorDismissedUntil(later)).toBe(
    later + INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  );
  expect(
    JSON.parse(
      window.localStorage.getItem(INSPECTOR_DISMISSAL_MIRROR_KEY) ?? "null",
    ),
  ).toEqual({
    until: later + INSPECTOR_DISMISSAL_MAX_DURATION_MS,
    forever: true,
  });
});

test("restores the Inspector only once both the cookie and mirror are cleared", () => {
  saveInspectorDismissedForever(NOW);

  document.cookie = `${INSPECTOR_DISMISSAL_COOKIE_NAME}=; Path=/; Max-Age=0`;
  expect(loadInspectorDismissedUntil(NOW)).not.toBeNull();

  document.cookie = `${INSPECTOR_DISMISSAL_COOKIE_NAME}=; Path=/; Max-Age=0`;
  window.localStorage.removeItem(INSPECTOR_DISMISSAL_MIRROR_KEY);
  expect(loadInspectorDismissedUntil(NOW)).toBeNull();
});
