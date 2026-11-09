import { render, screen } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, provide, ref, shallowRef } from "vue";
import type { PropType, Ref } from "vue";
import { z } from "zod";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../accessibility";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUI } from "../catalog";
import {
  useGenerativeUIFunction,
  useGenerativeUIState,
  useManagerVersion,
} from "../hooks";
import {
  GenerativeUINodeKey,
  GenerativeUIRuntimeKey,
} from "../runtime-context";
import type {
  GenerativeUINodeContextValue,
  GenerativeUIRuntime,
} from "../runtime-context";

/** A runtime with no provider around it, as React's hook tests build one. */
function createRuntime(ui: GenerativeUI): GenerativeUIRuntime {
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = ui;
  return {
    manager: new GenerativeUISurfaceManager(engineUI),
    ui,
    transport: "tool",
    config: { ui },
    reportError: vi.fn(),
    forwardEvent: vi.fn(),
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
}

/** Provides `runtime` to its default slot, as the provider will. */
function createRuntimeProvider(runtime: Readonly<Ref<GenerativeUIRuntime>>) {
  return defineComponent({
    setup() {
      provide(GenerativeUIRuntimeKey, runtime);
      return {};
    },
    template: "<slot />",
  });
}

describe("useGenerativeUIState", () => {
  const prefsUI = createGenerativeUI({
    id: "prefs",
    state: {
      prefs: z.object({
        theme: z.string().default("light"),
        size: z.number().int(),
      }),
    },
    components: {},
  });
  type PrefsInput = z.input<
    (typeof prefsUI.definitions & {})["state"]["prefs"]
  >;

  const Prefs = defineComponent({
    props: { value: { type: Object as PropType<PrefsInput>, required: true } },
    setup(props) {
      useGenerativeUIState(prefsUI, "prefs", () => props.value);
      return () => null;
    },
  });

  function mount(value: PrefsInput) {
    const runtime = createRuntime(prefsUI);
    const Provider = createRuntimeProvider(shallowRef(runtime));
    const Host = defineComponent({
      components: { Provider, Prefs },
      props: {
        value: { type: Object as PropType<PrefsInput>, required: true },
      },
      template: `<Provider><Prefs :value="value" /></Provider>`,
    });
    const utils = render(Host, { props: { value } });
    return {
      manager: runtime.manager,
      rerender: (next: PrefsInput) => utils.rerender({ value: next }),
      unmount: utils.unmount,
    };
  }

  it("stores the value parsed with the state schema, so defaults apply", () => {
    const { manager } = mount({ size: 2 });
    expect(manager.getState()).toEqual({ prefs: { theme: "light", size: 2 } });
  });

  it("does not store an invalid value and removes the earlier one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, rerender } = mount({ size: 2 });
    await rerender({ size: 2.5 });
    expect(manager.getState()).toEqual({});
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('invalid value for "prefs"'),
    );
    error.mockRestore();
  });

  describe("Vue-specific semantics", () => {
    it("follows a ref value and removes the key when the component unmounts", async () => {
      const runtime = createRuntime(prefsUI);
      const Provider = createRuntimeProvider(shallowRef(runtime));
      const size = ref(2);
      const RefPrefs = defineComponent({
        setup() {
          useGenerativeUIState(prefsUI, "prefs", () => ({ size: size.value }));
          return () => null;
        },
      });
      const Host = defineComponent({
        components: { Provider, RefPrefs },
        template: `<Provider><RefPrefs /></Provider>`,
      });
      const { unmount } = render(Host);

      size.value = 3;
      await Promise.resolve();
      expect(runtime.manager.getState()).toEqual({
        prefs: { theme: "light", size: 3 },
      });

      unmount();
      expect(runtime.manager.getState()).toEqual({});
    });

    it("stores the value of a schema that validates asynchronously", async () => {
      const asyncUI = createGenerativeUI({
        id: "async",
        state: { count: z.number().refine(async (n) => n >= 0) },
        components: {},
      });
      const runtime = createRuntime(asyncUI);
      const Provider = createRuntimeProvider(shallowRef(runtime));
      const Count = defineComponent({
        setup() {
          useGenerativeUIState(asyncUI, "count", 4);
          return () => null;
        },
      });
      const Host = defineComponent({
        components: { Provider, Count },
        template: `<Provider><Count /></Provider>`,
      });
      render(Host);

      await vi.waitFor(() =>
        expect(runtime.manager.getState()).toEqual({ count: 4 }),
      );
    });
  });
});

describe("useGenerativeUIFunction (Vue-specific semantics)", () => {
  const couponUI = createGenerativeUI({
    id: "coupon",
    functions: { applyCoupon: { parameters: z.object({ code: z.string() }) } },
    components: {},
  });

  it("throws the provider error outside a provider with a generativeUI config", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Coupon = defineComponent({
      setup() {
        useGenerativeUIFunction(couponUI, "applyCoupon", () => "applied");
        return () => null;
      },
    });

    expect(() => render(Coupon)).toThrow(
      'Generative UI components must be rendered inside <CopilotKitProvider :generative-ui="{ ui }">.',
    );
  });

  it("moves the handler to the dispatcher of a new runtime", async () => {
    const first = createRuntime(couponUI);
    const second = createRuntime(couponUI);
    const runtime = shallowRef(first);
    const Provider = createRuntimeProvider(runtime);
    const Coupon = defineComponent({
      setup() {
        useGenerativeUIFunction(couponUI, "applyCoupon", () => "applied");
        return () => null;
      },
    });
    const Host = defineComponent({
      components: { Provider, Coupon },
      template: `<Provider><Coupon /></Provider>`,
    });
    render(Host);

    runtime.value = second;
    await Promise.resolve();

    expect(first.dispatcher.listExposed()).toEqual({});
    await expect(
      second.dispatcher.invoke(
        "applyCoupon",
        { code: "SAVE" },
        { surfaceId: "s1", componentId: "root" },
      ),
    ).resolves.toEqual({ ok: true, result: "applied" });
  });
});

describe("useManagerVersion (Vue-specific semantics)", () => {
  const stateUI = createGenerativeUI({
    id: "state",
    state: { count: z.number() },
    components: {},
  });

  it("counts the changes of the latest manager and stops when the scope is disposed", async () => {
    const first = createRuntime(stateUI);
    const second = createRuntime(stateUI);
    const runtime = shallowRef<GenerativeUIRuntime | null>(first);
    const scope = effectScope();
    const version = scope.run(() => useManagerVersion(runtime))!;
    expect(version.value).toBe(0);

    first.manager.setState("count", 1);
    expect(version.value).toBe(1);

    runtime.value = second;
    await Promise.resolve();
    expect(version.value).toBe(0);
    first.manager.setState("count", 2);
    expect(version.value).toBe(0);

    runtime.value = null;
    await Promise.resolve();
    expect(version.value).toBe(0);

    runtime.value = second;
    await Promise.resolve();
    scope.stop();
    second.manager.setState("count", 3);
    expect(version.value).toBe(0);
  });
});

describe("useGenerativeUIAccessibility (Vue-specific semantics)", () => {
  const Panel = defineComponent({
    setup() {
      return { aria: useGenerativeUIAccessibility() };
    },
    template: `<section v-bind="aria" data-testid="panel"></section>`,
  });

  it("gives no attributes outside of generated UI", () => {
    render(Panel);
    expect(screen.getByTestId("panel").getAttributeNames()).toEqual([
      "data-testid",
    ]);
  });

  it("gives the ARIA attributes of the node being rendered, and follows its changes", async () => {
    const node = ref<GenerativeUINodeContextValue>({
      surfaceKey: "t1:s1",
      surfaceId: "s1",
      componentId: "root",
      accessibility: { label: "Totals", live: "polite" },
    });
    const Node = defineComponent({
      components: { Panel },
      setup() {
        provide(GenerativeUINodeKey, node);
        return {};
      },
      template: "<Panel />",
    });
    render(Node);

    const totals = screen.getByRole("region", { name: "Totals" });
    expect(totals.getAttribute("aria-live")).toBe("polite");

    node.value = { ...node.value, accessibility: { label: "Cart" } };
    await Promise.resolve();
    const panel = screen.getByRole("region", { name: "Cart" });
    expect(panel.getAttribute("aria-live")).toBeNull();
  });
});
