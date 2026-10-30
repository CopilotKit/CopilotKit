import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no layout, so it ships neither observer. Base UI and the
// standard components construct them on mount.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= ObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  ObserverStub as unknown as typeof IntersectionObserver;
// Base UI dispatches pointer events, which jsdom does not implement.
globalThis.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;
// Kumo Tabs scroll the selected tab into view.
Element.prototype.scrollIntoView ??= () => {};

afterEach(cleanup);
