import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick } from "vue";
import type { Component, PropType } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotKitMessageFilter } from "@copilotkit/core";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import type * as VueCoreModule from "../../lib/vue-core";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

/** Keeps the final turn only — the shape #1482 asks for. */
const keepLastTurn: CopilotKitMessageFilter = (messages) => messages.slice(-1);
/** A second, distinguishable filter, for asserting a swap took effect. */
const keepLastTwo: CopilotKitMessageFilter = (messages) => messages.slice(-2);

/**
 * Every config the provider constructed a core with, in order. The real class
 * still does the work — only the constructor argument is recorded — so these
 * tests read the same core the app would get.
 */
const ctorConfigs: { messageFilter?: CopilotKitMessageFilter }[] = [];

vi.mock("../../lib/vue-core", async (importOriginal) => {
  const actual = await importOriginal<typeof VueCoreModule>();
  class RecordingCore extends actual.CopilotKitCoreVue {
    constructor(
      config: ConstructorParameters<typeof actual.CopilotKitCoreVue>[0],
    ) {
      ctorConfigs.push(config as { messageFilter?: CopilotKitMessageFilter });
      super(config);
    }
  }
  return { ...actual, CopilotKitCoreVue: RecordingCore };
});

/**
 * Parity with React's `messageFilter` prop (#1482). The filter itself is
 * covered by `packages/core/src/__tests__/message-filter.test.ts`; what is
 * framework-specific, and what these assert, is that the prop reaches the core
 * both on mount and on a later change — including a change back to
 * `undefined`, which is how an app turns trimming off.
 */
function renderProvider(args: {
  child: Component;
  messageFilter?: CopilotKitMessageFilter;
}) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      ChildComponent: args.child,
    },
    props: {
      messageFilter: {
        type: Function as PropType<CopilotKitMessageFilter | undefined>,
        required: false,
        default: undefined,
      },
    },
    template: `
      <CopilotKitProvider
        runtime-url="/api/copilotkit"
        :message-filter="messageFilter"
      >
        <ChildComponent />
      </CopilotKitProvider>
    `,
  });

  return render(Host, {
    props: { messageFilter: args.messageFilter },
  });
}

function createCoreCollector(): {
  child: Component;
  getCore: () => CopilotKitCoreVue;
} {
  const instances: CopilotKitCoreVue[] = [];
  const Collector = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      instances.push(copilotkit.value);
      return () => null;
    },
  });
  return {
    child: Collector,
    getCore: () => {
      if (instances.length === 0) {
        throw new Error("CopilotKit core not captured yet");
      }
      return instances[instances.length - 1]!;
    },
  };
}

describe("CopilotKitProvider messageFilter", () => {
  beforeEach(() => {
    ctorConfigs.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("hands the filter to the core at construction, not only on mount", async () => {
    const { child } = createCoreCollector();
    renderProvider({ child, messageFilter: keepLastTurn });
    await nextTick();

    // The core opens its `/info` request from the constructor, and an agent
    // that response advertises is built with whatever filter the core holds
    // at that moment. A filter applied only from the mount effect would let
    // that first agent make its first run with the whole thread.
    expect(ctorConfigs.length).toBeGreaterThanOrEqual(1);
    expect(ctorConfigs[0]?.messageFilter).toBe(keepLastTurn);
  });

  it("threads the filter to the core on mount", async () => {
    const { child, getCore } = createCoreCollector();
    renderProvider({ child, messageFilter: keepLastTurn });
    await nextTick();

    expect(getCore().messageFilter).toBe(keepLastTurn);
  });

  it("leaves the core unfiltered when the prop is absent", async () => {
    const { child, getCore } = createCoreCollector();

    renderProvider({ child });
    await nextTick();

    expect(getCore().messageFilter).toBeUndefined();
  });

  it("adopts a filter the app swaps in after mount", async () => {
    const { child, getCore } = createCoreCollector();
    const view = renderProvider({ child, messageFilter: keepLastTurn });
    await nextTick();
    expect(getCore().messageFilter).toBe(keepLastTurn);

    await view.rerender({ messageFilter: keepLastTwo });
    await nextTick();

    expect(getCore().messageFilter).toBe(keepLastTwo);
  });

  it("clears the filter when the prop goes back to undefined", async () => {
    const { child, getCore } = createCoreCollector();
    const view = renderProvider({ child, messageFilter: keepLastTurn });
    await nextTick();
    expect(getCore().messageFilter).toBe(keepLastTurn);

    await view.rerender({ messageFilter: undefined });
    await nextTick();

    expect(getCore().messageFilter).toBeUndefined();
  });
});
