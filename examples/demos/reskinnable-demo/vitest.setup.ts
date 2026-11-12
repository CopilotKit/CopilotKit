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

/**
 * The 2.0 BuiltInAgent takes a TanStack AI adapter (`openaiText(...)`), and the
 * adapter reads OPENAI_API_KEY when it is CONSTRUCTED, not when it is called.
 * Unit tests build the agents to read their prompts and tools and never call
 * the model, so a placeholder key is enough.
 */
process.env.OPENAI_API_KEY ??= "test-placeholder-key";
