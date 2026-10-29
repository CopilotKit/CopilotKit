import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  GenerativeUISurfaceManager,
  createGenerativeUIDispatcher,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUIErrorInfo } from "@copilotkit/shared/generative-ui";
import type { GenerativeUI } from "../catalog";
import { GENERATIVE_UI_RUNTIME } from "../runtime";
import type { GenerativeUIRuntime } from "../runtime";
import { CopilotGenerativeUISurfaceView } from "../surface-view";

export const THREAD_ID = "thread";
export const SURFACE_ID = "surface";

export interface SurfaceRender {
  fixture: ComponentFixture<CopilotGenerativeUISurfaceView>;
  /** The host element of the surface view. */
  container: HTMLElement;
  runtime: GenerativeUIRuntime;
  reportError: Mock<(info: GenerativeUIErrorInfo) => void>;
  forwardEvent: Mock<GenerativeUIRuntime["forwardEvent"]>;
  /** Ingests more operations on the same surface and runs change detection. */
  update: (...operations: A2UIOperation[]) => void;
  /** Reads the surface data model at `path`. */
  dataAt: (path: string) => unknown;
  /** Runs change detection and the effects. */
  detectChanges: () => void;
  /** Runs change detection after `fn`, so signal writes reach the DOM. */
  act: (fn: () => void) => void;
}

/** A stub runtime around a real manager and dispatcher. */
export function createTestRuntime(ui: GenerativeUI) {
  const manager = new GenerativeUISurfaceManager(ui);
  const version = signal(0);
  manager.subscribe(() => version.update((n) => n + 1));
  const reportError = vi.fn<(info: GenerativeUIErrorInfo) => void>();
  const forwardEvent = vi.fn<GenerativeUIRuntime["forwardEvent"]>(async () => ({
    ok: true,
    result: undefined,
  }));
  const runtime: GenerativeUIRuntime = {
    manager,
    ui,
    transport: "tool",
    theme: signal(undefined),
    version: version.asReadonly(),
    reportError,
    forwardEvent,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  return { runtime, reportError, forwardEvent };
}

/**
 * Renders one surface of `ui` through the real engine. `components` is the
 * `updateComponents` list, with a component of id "root". `data` (optional)
 * is written to the data model at "/".
 */
export function renderSurface(
  ui: GenerativeUI,
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
): SurfaceRender {
  const { runtime, reportError, forwardEvent } = createTestRuntime(ui);
  TestBed.configureTestingModule({
    providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
  });
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
    runtime.manager.ingest(THREAD_ID, "default", content);
  };
  ingest();
  const surface = runtime.manager.getSurface(THREAD_ID, SURFACE_ID);
  if (!surface) throw new Error("renderSurface: the surface was not created.");
  const fixture = TestBed.createComponent(CopilotGenerativeUISurfaceView);
  fixture.componentRef.setInput("surface", surface);
  fixture.detectChanges();
  const detectChanges = () => {
    // Effects can create components whose own effects run in the next pass.
    fixture.detectChanges();
    fixture.detectChanges();
  };
  return {
    fixture,
    container: fixture.nativeElement as HTMLElement,
    runtime,
    reportError,
    forwardEvent,
    update: (...more) => {
      operations = [...operations, ...more];
      ingest();
      detectChanges();
    },
    dataAt: (path) => surface.model.dataModel.get(path),
    detectChanges,
    act: (fn) => {
      fn();
      detectChanges();
    },
  };
}

/** An `updateComponents` operation on the test surface. */
export function updateComponents(
  ...components: A2UIComponentNode[]
): A2UIOperation {
  return {
    version: "v1.0",
    updateComponents: { surfaceId: SURFACE_ID, components },
  };
}

/** An `updateDataModel` operation on the test surface. */
export function updateDataModel(path: string, value: unknown): A2UIOperation {
  return {
    version: "v1.0",
    updateDataModel: { surfaceId: SURFACE_ID, path, value },
  };
}
