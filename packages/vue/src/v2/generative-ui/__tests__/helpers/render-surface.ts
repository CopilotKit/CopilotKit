import { render } from "@testing-library/vue";
import { vi } from "vitest";
import { defineComponent, nextTick, provide, shallowRef } from "vue";
import type { Component } from "vue";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import type { GenerativeUI } from "../../catalog";
import { GenerativeUIRuntimeKey } from "../../runtime-context";
import type { GenerativeUIRuntime } from "../../runtime-context";
import { SurfaceView } from "../../SurfaceView";

const THREAD_ID = "thread";
export const SURFACE_ID = "surface";

/**
 * A runtime with no provider around it, as React's tests build one: a real
 * manager and dispatcher, and spies for `reportError` and `forwardEvent`.
 */
export function createTestRuntime(ui: GenerativeUI, errorFallback?: Component) {
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = ui;
  const reportError = vi.fn<GenerativeUIRuntime["reportError"]>();
  const forwardEvent = vi.fn<GenerativeUIRuntime["forwardEvent"]>(async () => ({
    ok: true,
    result: undefined,
  }));
  const runtime: GenerativeUIRuntime = {
    manager: new GenerativeUISurfaceManager(engineUI),
    ui,
    transport: "tool",
    config: { ui },
    reportError,
    forwardEvent,
    errorFallback,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  return { runtime, reportError, forwardEvent };
}

/** A component that provides `runtime` to its default slot, as the provider does. */
export function createRuntimeProvider(runtime: GenerativeUIRuntime) {
  return defineComponent({
    setup() {
      provide(GenerativeUIRuntimeKey, shallowRef(runtime));
      return {};
    },
    template: "<slot />",
  });
}

/**
 * Renders one surface of `ui` through the real engine. `components` is the
 * `updateComponents` list, with a component of id "root". `data` (optional)
 * is written to the data model at "/". The Vue port of React's
 * `standard/__tests__/render.tsx`.
 *
 * The result has the testing-library queries, plus:
 * - `update(...operations)`: ingests more operations on the same surface,
 *   and resolves after Vue flushed the change.
 * - `dataAt(path)`: reads the surface data model.
 * - `reportError`, `forwardEvent`: spies of the runtime.
 */
export function renderSurface(
  ui: GenerativeUI,
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) {
  const { runtime, reportError, forwardEvent } = createTestRuntime(ui);
  let operations: A2UIOperation[] = [
    {
      version: "1.0",
      createSurface: { surfaceId: SURFACE_ID, catalogId: ui.id },
    },
    {
      version: "1.0",
      updateComponents: { surfaceId: SURFACE_ID, components },
    },
  ];
  if (data) {
    operations.push({
      version: "1.0",
      updateDataModel: { surfaceId: SURFACE_ID, path: "/", value: data },
    });
  }
  const ingest = () => {
    const content: GenerativeUISurfaceContent = {
      surfaceId: SURFACE_ID,
      target: "inline",
      catalogId: ui.id,
      operations,
      status: "streaming",
      rejected: [],
    };
    runtime.manager.ingest(THREAD_ID, "default", content);
  };
  ingest();
  const surface = runtime.manager.getSurface(THREAD_ID, SURFACE_ID);
  if (!surface) throw new Error("renderSurface: the surface was not created.");
  const Provider = createRuntimeProvider(runtime);
  const Host = defineComponent({
    components: { Provider, SurfaceView },
    setup: () => ({ surface }),
    template: `<Provider><SurfaceView :surface="surface" /></Provider>`,
  });
  const result = render(Host);
  return Object.assign(result, {
    reportError,
    forwardEvent,
    update: (...more: A2UIOperation[]) => {
      operations = [...operations, ...more];
      ingest();
      return nextTick();
    },
    dataAt: (path: string) => surface.model.dataModel.get(path),
  });
}
