import React from "react";
import { act, render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { GenerativeUI } from "../../catalog";
import { createGenerativeUIDispatcher } from "../../dispatcher";
import type { GenerativeUIErrorInfo } from "../../errors";
import { GenerativeUIRuntimeContext } from "../../runtime-context";
import type { GenerativeUIRuntime } from "../../runtime-context";
import { GenerativeUISurfaceManager } from "../../surface-manager";
import { SurfaceView } from "../../SurfaceView";

const THREAD_ID = "thread";
export const SURFACE_ID = "surface";

/**
 * What `renderSurface` gives. It is written out because the inferred type
 * refers to a pretty-format type that the declaration emit cannot name.
 */
export interface SurfaceRender extends RenderResult {
  reportError: Mock<GenerativeUIRuntime["reportError"]>;
  forwardEvent: Mock<GenerativeUIRuntime["forwardEvent"]>;
  /** Ingests more operations on the same surface. */
  update: (...operations: A2UIOperation[]) => void;
  /** Reads the surface data model at `path`. */
  dataAt: (path: string) => unknown;
}

/**
 * Renders one surface of `ui` through the real engine. `components` is the
 * `updateComponents` list, with a component of id "root". `data` (optional)
 * is written to the data model at "/".
 *
 * The result has the testing-library queries, plus:
 * - `update(...operations)`: ingests more operations on the same surface.
 * - `dataAt(path)`: reads the surface data model.
 * - `reportError`, `forwardEvent`: spies of the runtime.
 */
export function renderSurface(
  ui: GenerativeUI,
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
  options?: Pick<GenerativeUIRuntime, "errorFallback">,
): SurfaceRender {
  const manager = new GenerativeUISurfaceManager(ui);
  const reportError = vi.fn<(info: GenerativeUIErrorInfo) => void>();
  const forwardEvent = vi.fn<GenerativeUIRuntime["forwardEvent"]>(async () => ({
    ok: true,
    result: undefined,
  }));
  const runtime: GenerativeUIRuntime = {
    manager,
    ui,
    transport: "tool",
    config: { ui },
    reportError,
    forwardEvent,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
    errorFallback: options?.errorFallback,
  };
  let operations: A2UIOperation[] = [
    {
      version: "v1.0",
      createSurface: { surfaceId: SURFACE_ID, catalogId: ui.id },
    },
    {
      version: "v1.0",
      updateComponents: { surfaceId: SURFACE_ID, components },
    },
  ];
  if (data) {
    operations.push({
      version: "v1.0",
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
    act(() => manager.ingest(THREAD_ID, "default", content));
  };
  ingest();
  const surface = manager.getSurface(THREAD_ID, SURFACE_ID);
  if (!surface) throw new Error("renderSurface: the surface was not created.");
  const result = render(
    <GenerativeUIRuntimeContext.Provider value={runtime}>
      <SurfaceView surface={surface} />
    </GenerativeUIRuntimeContext.Provider>,
  );
  return Object.assign(result, {
    reportError,
    forwardEvent,
    update: (...more: A2UIOperation[]) => {
      operations = [...operations, ...more];
      ingest();
    },
    dataAt: (path: string) => surface.model.dataModel.get(path),
  });
}
