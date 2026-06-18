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
}): void {
  const { surfaceRef, operations, config } = options;
  let destroyed = false;
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
  });

  const sync = (element = surfaceRef()?.nativeElement): void => {
    if (destroyed) return;
    syncA2UISurface(element, operations(), config);
  };

  void defineA2UIWebComponentsOnce().then(() => sync());

  afterRenderEffect({
    write: () => {
      operations();
      const surface = surfaceRef();
      if (!surface) return;
      sync(surface.nativeElement);
    },
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
    const { a2uiAction, ...rest } = copilotKit.core.properties;
    copilotKit.core.setProperties(rest);
  }
}
