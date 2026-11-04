/**
 * jsdom implements no layout, so it ships no ResizeObserver. react-resizable-panels
 * constructs one on mount, so without this stub every test that renders a Group
 * throws "ResizeObserver is not defined".
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
