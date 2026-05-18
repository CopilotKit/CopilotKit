import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, nextTick } from "vue";
import type { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { z } from "zod";
import type {
  Subscription,
  EventSource,
  ComponentModel,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { Catalog, GenericBinder } from "@a2ui/web_core/v0_9";
import { DeferredChild } from "../vue-renderer/A2uiSurface";
import { createVueComponent } from "../vue-renderer/adapter";
import type { VueComponentImplementation } from "../vue-renderer/adapter";

interface MockEventSource<T> extends EventSource<T> {
  _listeners: Set<(data: T) => void>;
  _subscribeCalls: number;
  _unsubscribeCalls: number;
  emit(data: T): void;
}

interface MockComponent {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

interface MockContext {
  componentModel: { id: string };
}

function createMockEventSource<T>(): MockEventSource<T> {
  const listeners = new Set<(data: T) => void>();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;

  return {
    _listeners: listeners,
    get _subscribeCalls() {
      return subscribeCalls;
    },
    get _unsubscribeCalls() {
      return unsubscribeCalls;
    },
    subscribe(listener: (data: T) => void): Subscription {
      subscribeCalls++;
      listeners.add(listener);
      return {
        unsubscribe() {
          unsubscribeCalls++;
          listeners.delete(listener);
        },
      };
    },
    emit(data: T) {
      for (const l of listeners) l(data);
    },
  };
}

function createMockSurface(id = "test-surface") {
  const onCreated = createMockEventSource<ComponentModel>();
  const onDeleted = createMockEventSource<string>();
  const components = new Map<string, MockComponent>();

  return {
    id,
    catalog: new Catalog("test-catalog", []),
    theme: undefined,
    sendDataModel: false,
    dataModel: { get: () => undefined, set: () => {} },
    componentsModel: {
      onCreated,
      onDeleted,
      get: (compId: string) => components.get(compId),
      addComponent(comp: MockComponent) {
        components.set(comp.id, comp);
        onCreated.emit(comp as unknown as ComponentModel);
      },
      removeComponent(compId: string) {
        components.delete(compId);
        onDeleted.emit(compId);
      },
      entries: components.entries(),
      dispose() {
        components.clear();
      },
    },
    onAction: createMockEventSource<unknown>(),
    onError: createMockEventSource<unknown>(),
    dispatchAction: vi.fn(),
    dispatchError: vi.fn(),
    dispose: vi.fn(),
  };
}

type MockSurface = ReturnType<typeof createMockSurface>;

function mountDeferredChild(props: {
  surface: MockSurface;
  id: string;
  basePath: string;
}) {
  return mount(
    DeferredChild as unknown as ReturnType<typeof defineComponent>,
    { props: props as unknown as Record<string, unknown> },
  );
}

describe("A2uiSurface lifecycle (Vue-specific)", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("DeferredChild subscription cleanup on prop changes", () => {
    it("unsubscribes from old surface when surface prop changes", async () => {
      const surface1 = createMockSurface("s1");
      const surface2 = createMockSurface("s2");

      const wrapper = mountDeferredChild({
        surface: surface1,
        id: "root",
        basePath: "/",
      });

      expect(surface1.componentsModel.onCreated._subscribeCalls).toBe(1);
      expect(surface1.componentsModel.onDeleted._subscribeCalls).toBe(1);

      await wrapper.setProps({
        surface: surface2 as unknown as SurfaceModel<VueComponentImplementation>,
      });
      await nextTick();

      expect(surface1.componentsModel.onCreated._unsubscribeCalls).toBe(1);
      expect(surface1.componentsModel.onDeleted._unsubscribeCalls).toBe(1);

      expect(surface2.componentsModel.onCreated._subscribeCalls).toBe(1);
      expect(surface2.componentsModel.onDeleted._subscribeCalls).toBe(1);

      wrapper.unmount();
    });

    it("unsubscribes from old surface when id prop changes", async () => {
      const surface = createMockSurface("s1");

      const wrapper = mountDeferredChild({
        surface,
        id: "comp-a",
        basePath: "/",
      });

      expect(surface.componentsModel.onCreated._subscribeCalls).toBe(1);

      await wrapper.setProps({ id: "comp-b" });
      await nextTick();

      expect(surface.componentsModel.onCreated._unsubscribeCalls).toBe(1);
      expect(surface.componentsModel.onCreated._subscribeCalls).toBe(2);

      wrapper.unmount();
    });

    it("cleans up all subscriptions on unmount", async () => {
      const surface = createMockSurface("s1");

      const wrapper = mountDeferredChild({
        surface,
        id: "root",
        basePath: "/",
      });

      expect(surface.componentsModel.onCreated._subscribeCalls).toBe(1);
      expect(surface.componentsModel.onDeleted._subscribeCalls).toBe(1);

      wrapper.unmount();

      expect(surface.componentsModel.onCreated._unsubscribeCalls).toBe(1);
      expect(surface.componentsModel.onDeleted._unsubscribeCalls).toBe(1);
    });
  });

  describe("ComponentContext stability", () => {
    it("DeferredChild provides stable context across re-renders", async () => {
      const surface = createMockSurface("s1");

      const TextComponent = createVueComponent(
        { name: "Text", schema: z.object({ text: z.string().optional() }) } as unknown as Parameters<typeof createVueComponent>[0],
        ({ props }) => h("span", {}, (props as { text?: string }).text ?? ""),
      );
      surface.catalog = {
        components: new Map([["Text", TextComponent]]),
      } as unknown as Catalog;
      surface.componentsModel.addComponent({
        id: "root",
        type: "Text",
        properties: {},
      });

      const disposeSpy = vi.spyOn(GenericBinder.prototype, "dispose").mockImplementation(() => {});
      const subscribeSpy = vi.spyOn(GenericBinder.prototype, "subscribe").mockImplementation(
        () => ({ unsubscribe: vi.fn() }),
      );
      const snapshotSpy = vi.spyOn(GenericBinder.prototype, "snapshot" as never, "get")
        .mockReturnValue({ text: "hello" } as never);

      try {
        const wrapper = mountDeferredChild({
          surface,
          id: "root",
          basePath: "/",
        });
        await nextTick();

        expect(wrapper.text()).toContain("hello");

        await wrapper.vm.$forceUpdate();
        await nextTick();
        await wrapper.vm.$forceUpdate();
        await nextTick();

        // DeferredChild's computed context is stable → adapter never disposes the binder
        expect(disposeSpy).not.toHaveBeenCalled();

        wrapper.unmount();
      } finally {
        disposeSpy.mockRestore();
        subscribeSpy.mockRestore();
        snapshotSpy.mockRestore();
      }
    });
  });

  describe("Adapter binder subscription cleanup", () => {
    function spyOnBinder() {
      const unsubscribeSpy = vi.fn();
      const disposeSpy = vi.spyOn(GenericBinder.prototype, "dispose").mockImplementation(() => {});
      const subscribeSpy = vi.spyOn(GenericBinder.prototype, "subscribe").mockImplementation(
        () => ({ unsubscribe: unsubscribeSpy }),
      );
      const snapshotSpy = vi.spyOn(GenericBinder.prototype, "snapshot" as never, "get")
        .mockReturnValue({} as never);

      return {
        disposeSpy,
        unsubscribeSpy,
        restore() {
          disposeSpy.mockRestore();
          subscribeSpy.mockRestore();
          snapshotSpy.mockRestore();
        },
      };
    }

    it("calls dispose on old binder when context changes", async () => {
      const { disposeSpy, unsubscribeSpy, restore } = spyOnBinder();

      try {
        const TextApi = {
          name: "Text",
          schema: z.object({ text: z.string().optional() }),
        };

        const TextComponent = createVueComponent(
          TextApi as unknown as Parameters<typeof createVueComponent>[0],
          ({ props }) => h("span", {}, (props as { text?: string }).text ?? ""),
        );

        const ctx1: MockContext = { componentModel: { id: "c1" } };
        const ctx2: MockContext = { componentModel: { id: "c2" } };

        const wrapper = mount(TextComponent.render, {
          props: { context: ctx1, buildChild: () => h("div") },
        });
        await nextTick();

        await wrapper.setProps({ context: ctx2 });
        await nextTick();

        expect(disposeSpy).toHaveBeenCalled();
        expect(unsubscribeSpy).toHaveBeenCalled();

        wrapper.unmount();
      } finally {
        restore();
      }
    });

    it("calls dispose and unsubscribe on unmount", async () => {
      const { disposeSpy, unsubscribeSpy, restore } = spyOnBinder();

      try {
        const TextApi = {
          name: "Text",
          schema: z.object({ text: z.string().optional() }),
        };

        const TextComponent = createVueComponent(
          TextApi as unknown as Parameters<typeof createVueComponent>[0],
          ({ props }) => h("span", {}, (props as { text?: string }).text ?? ""),
        );

        const ctx: MockContext = { componentModel: { id: "c1" } };

        const wrapper = mount(TextComponent.render, {
          props: { context: ctx, buildChild: () => h("div") },
        });
        await nextTick();

        wrapper.unmount();

        expect(disposeSpy).toHaveBeenCalled();
        expect(unsubscribeSpy).toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });
});
