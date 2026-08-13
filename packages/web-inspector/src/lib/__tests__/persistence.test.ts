import { afterEach, describe, expect, it } from "vitest";

import { loadInspectorState, saveInspectorState } from "../persistence.js";

const KEY = "cpk:inspector:state";

function restoreLocalStorage(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, "localStorage", descriptor);
    return;
  }
  Reflect.deleteProperty(window, "localStorage");
}

afterEach(() => {
  window.localStorage.clear();
});

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
