import {
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  type Signal,
} from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  Catalog,
  LitComponentImplementation,
  LitRenderable,
  Theme,
} from "@copilotkit/a2ui-renderer/web-components";
import type { A2UIConfig } from "../../config";

export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export type A2UIOperation = Record<string, unknown>;

export type A2UISurfaceElement = HTMLElement & {
  operations?: A2UIOperation[];
  catalog?: Catalog<LitComponentImplementation>;
  theme?: Theme;
  loadingComponent?: () => LitRenderable;
  updateComplete?: Promise<boolean>;
};

export type A2UIConfigLike = { a2ui?: A2UIConfig };

type CopilotKitActionBridge = {
  core: {
    properties: Record<string, unknown>;
    setProperties(properties: Record<string, unknown>): void;
    runAgent(options: { agent: AbstractAgent }): Promise<unknown>;
  };
};

let definePromise: Promise<void> | undefined;

export function defineA2UIWebComponentsOnce(): Promise<void> {
  if (typeof globalThis.customElements === "undefined") {
    return Promise.resolve();
  }
  definePromise ??=
    import("@copilotkit/a2ui-renderer/web-components/define").then(
      async (mod) => {
        mod.defineA2UIWebComponents();
        await customElements.whenDefined("cpk-a2ui-surface");
        await Promise.resolve();
      },
    );
  return definePromise;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getA2UIOperations(content: unknown): A2UIOperation[] {
  if (!isRecord(content)) return [];

  const operations = content[A2UI_OPERATIONS_KEY] ?? content.operations;
  if (!Array.isArray(operations)) return [];
  return operations.filter(isRecord);
}

export function syncA2UISurface(
  element: A2UISurfaceElement | null | undefined,
  operations: A2UIOperation[],
  config?: A2UIConfigLike | null,
): void {
  if (!element) return;
  element.operations = operations;
  element.catalog = config?.a2ui?.catalog;
  element.theme = config?.a2ui?.theme;
  element.loadingComponent = config?.a2ui?.loadingComponent;
}

/**
 * Wires a reactive A2UI surface element to its operations source.
 *
 * Defines the web components once, then keeps the surface in sync after every
 * render whenever the `operations` or `surfaceRef` signals change. Must be
 * called from an injection context (e.g. a component constructor).
 */
export function connectA2UISurface(options: {
  surfaceRef: Signal<ElementRef<A2UISurfaceElement> | undefined>;
  operations: () => A2UIOperation[];
  config?: A2UIConfigLike | null;
  onReady?: () => void;
}): void {
  const { surfaceRef, operations, config, onReady } = options;
  const canRender = typeof globalThis.customElements !== "undefined";
  let destroyed = false;
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
  });

  const sync = (element = surfaceRef()?.nativeElement): void => {
    if (destroyed || !element) return;
    const nextOperations = operations();
    syncA2UISurface(element, nextOperations, config);
    if (canRender && onReady && surfaceHasRenderableContent(nextOperations)) {
      void (element.updateComplete ?? Promise.resolve()).then(() => {
        if (!destroyed) onReady();
      });
    }
  };

  if (canRender) {
    void defineA2UIWebComponentsOnce().then(
      () => sync(),
      (error: unknown) =>
        console.error("[A2UI Angular] failed to load the renderer:", error),
    );
  }

  afterRenderEffect({
    write: () => {
      operations();
      const surface = surfaceRef();
      if (!surface) return;
      sync(surface.nativeElement);
    },
  });
}

/** Whether operations can paint visible static or data-bound content. */
export function surfaceHasRenderableContent(
  operations: readonly A2UIOperation[],
): boolean {
  const componentOperations = operations.filter((operation) =>
    isRecord(operation["updateComponents"]),
  );
  if (componentOperations.length === 0) return false;
  const requiresData = JSON.stringify(componentOperations).includes('"path"');
  if (!requiresData) return true;
  return operations.some((operation) => {
    const update = operation["updateDataModel"];
    if (!isRecord(update) || !isRecord(update["value"])) return false;
    return Object.values(update["value"]).some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && value !== "",
    );
  });
}

export function logA2UIRenderError(event: Event): void {
  console.warn("[A2UI Angular] render error:", (event as CustomEvent).detail);
}

export async function bridgeA2UIAction(
  copilotKit: CopilotKitActionBridge | null | undefined,
  agent: AbstractAgent | undefined,
  detail: unknown,
): Promise<void> {
  if (!copilotKit || !agent) return;

  try {
    copilotKit.core.setProperties({
      ...copilotKit.core.properties,
      a2uiAction: detail,
    });
    await copilotKit.core.runAgent({ agent });
  } finally {
    const { a2uiAction: _a2uiAction, ...rest } = copilotKit.core.properties;
    copilotKit.core.setProperties(rest);
  }
}
