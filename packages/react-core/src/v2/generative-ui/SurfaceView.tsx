import React, {
  memo,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ComponentModel, SurfaceModel } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import {
  GENERATIVE_UI_ROOT_ID,
  isActionBinding,
  isPathBinding,
} from "@copilotkit/shared";
import type { GenerativeUIActionBinding } from "@copilotkit/shared";
import type { GenerativeUIComponentDefinition } from "./catalog";
import {
  DefaultNodeFallback,
  NodeBoundary,
  NodePlaceholder,
  SurfaceBoundary,
} from "./boundaries";
import type { GenerativeUIInvokeResult } from "./errors";
import { invokeBoundEvent } from "./events";
import {
  GenerativeUINodeContext,
  reportErrorSafely,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import type {
  GenerativeUISurfaceManager,
  ManagedSurface,
} from "./surface-manager";

const EMPTY_PROPS = z.object({});
const NO_ANCESTORS: readonly string[] = [];
// No surface state exists on the server or during hydration.
const undefinedSnapshot = () => undefined;

export function SurfaceView({ surface }: { surface: ManagedSurface }) {
  const runtime = useRequiredGenerativeUIRuntime();
  return (
    <SurfaceBoundary surfaceId={surface.surfaceId} runtime={runtime}>
      <NodeView
        surface={surface}
        componentId={GENERATIVE_UI_ROOT_ID}
        ancestors={NO_ANCESTORS}
      />
    </SurfaceBoundary>
  );
}

/**
 * Resolves a component by id. Subscribes to the manager rather than web_core's
 * `onCreated`/`onDeleted`: web_core's EventEmitter awaits each listener in turn,
 * so with several subscribers (one per slotted child, or one per mount of the
 * same surface) all but the first are notified a microtask late. That is only
 * visible inside synchronous flushes such as `act()` / `flushSync`, where the
 * old tree would still be on screen, but it makes updates order-dependent.
 * The manager notifies synchronously once an ingest has been fully applied.
 */
function useComponentModel(
  manager: GenerativeUISurfaceManager,
  model: SurfaceModel<any>,
  id: string,
): ComponentModel | undefined {
  return useSyncExternalStore(
    manager.subscribe,
    () => model.componentsModel.get(id),
    undefinedSnapshot,
  );
}

/** Same reasoning as `useComponentModel`: never rely on web_core's emitters. */
function useComponentProperties(
  manager: GenerativeUISurfaceManager,
  component: ComponentModel | undefined,
) {
  return useSyncExternalStore(
    manager.subscribe,
    () => component?.properties,
    undefinedSnapshot,
  );
}

const NodeView = memo(function NodeView({
  surface,
  componentId,
  ancestors,
}: {
  surface: ManagedSurface;
  componentId: string;
  /** Ids of the nodes above this one; used to cut cyclic slot references. */
  ancestors: readonly string[];
}) {
  const runtime = useRequiredGenerativeUIRuntime();
  const component = useComponentModel(
    runtime.manager,
    surface.model,
    componentId,
  );
  const properties = useComponentProperties(runtime.manager, component);
  if (ancestors.includes(componentId)) {
    return (
      <DefaultNodeFallback
        message={`cyclic reference to ${componentId}`}
        componentId={componentId}
      />
    );
  }
  if (!component || !properties)
    return <NodePlaceholder componentId={componentId} />;
  const definition = runtime.catalog.components.get(component.type);
  if (!definition) {
    return (
      <DefaultNodeFallback
        message={`unknown component "${component.type}"`}
        componentId={componentId}
      />
    );
  }
  return (
    <NodeBoundary
      key={component.type}
      surfaceId={surface.surfaceId}
      componentId={componentId}
      revision={properties}
      runtime={runtime}
    >
      <ResolvedNode
        surface={surface}
        componentId={componentId}
        definition={definition}
        properties={properties}
        runtime={runtime}
        ancestors={ancestors}
      />
    </NodeBoundary>
  );
});

function useBoundDataProps(
  surface: ManagedSurface,
  definition: GenerativeUIComponentDefinition,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const dataModel = surface.model.dataModel;
  const entries = useMemo(
    () =>
      Object.entries(properties).filter(
        ([key]) => !definition.events?.[key] && !definition.slots?.[key],
      ),
    [properties, definition],
  );
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    resolved[key] = isPathBinding(value) ? dataModel.get(value.path) : value;
  }
  // The values this render was based on, so the effect can detect a write that
  // landed between render and subscription (web_core never replays the current
  // value on subscribe).
  const rendered = useRef(resolved);
  rendered.current = resolved;
  useEffect(() => {
    const bound = entries.flatMap(([key, value]) =>
      isPathBinding(value) ? [{ key, path: value.path }] : [],
    );
    const subscriptions = bound.map(({ path }) =>
      dataModel.subscribe(path, () => rerender()),
    );
    if (
      bound.some(
        ({ key, path }) =>
          !Object.is(dataModel.get(path), rendered.current[key]),
      )
    ) {
      rerender();
    }
    return () => subscriptions.forEach((s) => s.unsubscribe());
  }, [dataModel, entries]);
  return resolved;
}

function useEventProps(
  runtime: GenerativeUIRuntime,
  surface: ManagedSurface,
  componentId: string,
  definition: GenerativeUIComponentDefinition,
  properties: Record<string, unknown>,
) {
  const latest = useRef(properties);
  latest.current = properties;
  const boundNames = Object.keys(definition.events ?? {})
    .filter((name) => isActionBinding(properties[name]))
    .join("|");
  return useMemo(() => {
    const handlers: Record<
      string,
      (args?: unknown) => Promise<GenerativeUIInvokeResult>
    > = {};
    for (const name of boundNames ? boundNames.split("|") : []) {
      handlers[name] = (args) =>
        invokeBoundEvent({
          runtime,
          surface,
          componentId,
          name,
          parameters: definition.events![name].parameters,
          binding: latest.current[name] as GenerativeUIActionBinding,
          args,
        });
    }
    return handlers;
  }, [boundNames, runtime, surface, componentId, definition]);
}

function useSlotProps(
  surface: ManagedSurface,
  definition: GenerativeUIComponentDefinition,
  properties: Record<string, unknown>,
  componentId: string,
  ancestors: readonly string[],
) {
  return useMemo(() => {
    const childAncestors = [...ancestors, componentId];
    const slots: Record<string, ReactNode> = {};
    for (const [name, kind] of Object.entries(definition.slots ?? {})) {
      const value = properties[name];
      if (kind === "single" && typeof value === "string") {
        slots[name] = (
          <NodeView
            surface={surface}
            componentId={value}
            ancestors={childAncestors}
          />
        );
      } else if (kind === "multiple" && Array.isArray(value)) {
        // Dedupe so React keys stay unique if the agent repeats an id.
        const ids = [
          ...new Set(
            value.filter((id): id is string => typeof id === "string"),
          ),
        ];
        slots[name] = ids.map((id) => (
          <NodeView
            key={id}
            surface={surface}
            componentId={id}
            ancestors={childAncestors}
          />
        ));
      }
    }
    return slots;
  }, [surface, definition, properties, componentId, ancestors]);
}

function ResolvedNode({
  surface,
  componentId,
  definition,
  properties,
  runtime,
  ancestors,
}: {
  surface: ManagedSurface;
  componentId: string;
  definition: GenerativeUIComponentDefinition;
  properties: Record<string, unknown>;
  runtime: GenerativeUIRuntime;
  ancestors: readonly string[];
}) {
  const dataProps = useBoundDataProps(surface, definition, properties);
  const eventProps = useEventProps(
    runtime,
    surface,
    componentId,
    definition,
    properties,
  );
  const slotProps = useSlotProps(
    surface,
    definition,
    properties,
    componentId,
    ancestors,
  );
  const nodeContext = useMemo(
    () => ({
      surfaceKey: surface.key,
      surfaceId: surface.surfaceId,
      componentId,
    }),
    [surface.key, surface.surfaceId, componentId],
  );
  const parsed = (definition.props ?? EMPTY_PROPS).safeParse(dataProps);
  const problem = parsed.success
    ? undefined
    : parsed.error.issues
        .map((i) => `${i.path.join(".") || "props"}: ${i.message}`)
        .join("; ");

  useEffect(() => {
    if (problem) {
      reportErrorSafely(runtime, {
        kind: "props",
        surfaceId: surface.surfaceId,
        componentId,
        error: new Error(`Invalid props: ${problem}`),
      });
    }
  }, [problem, runtime, surface.surfaceId, componentId]);

  if (!parsed.success) {
    return (
      <DefaultNodeFallback
        message={`invalid props (${problem})`}
        componentId={componentId}
      />
    );
  }
  const Component = definition.component;
  return (
    <GenerativeUINodeContext.Provider value={nodeContext}>
      <Component {...parsed.data} {...eventProps} {...slotProps} />
    </GenerativeUINodeContext.Provider>
  );
}
