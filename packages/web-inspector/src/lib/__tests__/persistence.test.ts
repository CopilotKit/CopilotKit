import { afterEach, describe, expect, it, test, vi } from "vitest";

import {
  clearInspectorDismissal,
  INSPECTOR_DISMISSAL_COOKIE_NAME,
  INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  INSPECTOR_DISMISSAL_MIRROR_KEY,
  loadInspectorDismissedUntil,
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


import { loadInspectorState, saveInspectorState } from "../persistence.js";

const KEY = "cpk:inspector:state";

function restoreLocalStorage(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, "localStorage", descriptor);
    return;
  }
  Reflect.deleteProperty(window, "localStorage");
}


describe("loadInspectorState", () => {
  it("returns persisted state when localStorage is available", () => {
    const state = { isOpen: true, selectedMenu: "threads" };
    window.localStorage.setItem(KEY, JSON.stringify(state));

    expect(loadInspectorState(KEY)).toEqual(state);
  });

  it("returns null when window.localStorage is missing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(loadInspectorState(KEY)).toBeNull();
    } finally {
      restoreLocalStorage(descriptor);
    }
  });

  it("returns null when localStorage has no getItem", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {},
    });

    try {
      expect(loadInspectorState(KEY)).toBeNull();
    } finally {
      restoreLocalStorage(descriptor);
    }
  });
});

describe("saveInspectorState", () => {
  it("writes state when localStorage is available", () => {
    saveInspectorState(KEY, { isOpen: false });

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual({
      isOpen: false,
    });
  });

  it("does not throw when window.localStorage is missing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(() => saveInspectorState(KEY, { isOpen: true })).not.toThrow();
    } finally {
      restoreLocalStorage(descriptor);
    }
  });
});
