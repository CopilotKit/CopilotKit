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
import type { z } from "zod";
import {
  GENERATIVE_UI_ROOT_ID,
  isActionBinding,
  isPathBinding,
} from "@copilotkit/shared";
import type { GenerativeUIActionBinding } from "@copilotkit/shared";
import { shallowEqual, useShallowStableRef } from "../lib/shallow-stable-ref";
import type { ResolvedGenerativeUIComponent } from "./catalog";
import {
  DefaultNodeFallback,
  NodeBoundary,
  NodePlaceholder,
  SurfaceBoundary,
} from "./boundaries";
import type { GenerativeUIInvokeResult } from "./errors";
import { invokeBoundEvent, invokeMatchedEvent } from "./events";
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

const NO_ANCESTORS: readonly string[] = [];
// No surface state exists on the server or during hydration.
const undefinedSnapshot = () => undefined;
const noopSubscribe = () => () => {};

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
  const definition = runtime.ui.components.get(component.type);
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

/**
 * The props the model sets, with `{ path }` bindings read from the surface
 * data model. Bound props, events and slots are left out. The result is the
 * same object until a value changes.
 */
function useModelDataProps(
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const dataModel = surface.model.dataModel;
  const entries = useMemo(
    () =>
      Object.entries(properties).filter(
        ([key]) =>
          !definition.events?.[key] &&
          !definition.slots?.[key] &&
          !Object.hasOwn(definition.selectors, key),
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
  return useShallowStableRef(resolved);
}

/** The selector results of one node, or the reason they could not be read. */
type Selection =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problem: string };

const NO_SELECTION: Selection = { ok: true, values: {} };

function isSameSelection(a: Selection, b: Selection) {
  if (a.ok && b.ok) return shallowEqual(a.values, b.values);
  if (!a.ok && !b.ok) return a.problem === b.problem;
  return false;
}

/** Runs every selector of a node. A selector that throws gives a problem. */
function select(
  definition: ResolvedGenerativeUIComponent,
  state: Readonly<Record<string, unknown>>,
  modelProps: Record<string, unknown>,
): Selection {
  const values: Record<string, unknown> = {};
  const selectors = Object.entries(definition.selectors);
  for (const [key, selector] of selectors) {
    try {
      values[key] = selector(state, modelProps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, problem: `${key}: selector threw: ${message}` };
    }
  }
  return { ok: true, values };
}

interface SelectionCache {
  state: Readonly<Record<string, unknown>>;
  modelProps: Record<string, unknown>;
  selection: Selection;
}

/**
 * The values of the bound props of a node, read from the app state.
 *
 * The selectors run again only when the state object or the parsed model
 * props change. When the new values are shallow-equal to the last ones, the
 * last snapshot is kept. So the node re-renders only when a selected value
 * changes. A selector that returns a new array on each call cannot cause a
 * render loop: with the same inputs, the cached snapshot comes back.
 *
 * A node without bound props does not subscribe to the state.
 */
function useSelection(
  manager: GenerativeUISurfaceManager,
  definition: ResolvedGenerativeUIComponent,
  modelProps: Record<string, unknown> | undefined,
) {
  const hasSelectors = Object.keys(definition.selectors).length > 0;
  const cache = useRef<SelectionCache | undefined>(undefined);
  const getSnapshot = () => {
    if (!hasSelectors || modelProps === undefined) return NO_SELECTION;
    const state = manager.getState();
    const cached = cache.current;
    const isCacheHit =
      cached !== undefined &&
      cached.state === state &&
      cached.modelProps === modelProps;
    if (isCacheHit) return cached.selection;
    const next = select(definition, state, modelProps);
    const selection =
      cached !== undefined && isSameSelection(cached.selection, next)
        ? cached.selection
        : next;
    cache.current = { state, modelProps, selection };
    return selection;
  };
  // The server uses the same snapshot. It reads the state that is set now.
  return useSyncExternalStore(
    hasSelectors ? manager.subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
}

function issuesOf(error: z.ZodError) {
  return error.issues
    .map((i) => `${i.path.join(".") || "props"}: ${i.message}`)
    .join("; ");
}

type DataProps =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; problem: string };

/**
 * The data props of a node, in three steps: parse the model-set props with
 * `modelProps`, run the selectors with them, then parse the selector results
 * with `boundProps`. Gives the reason when a step fails.
 */
function useDataProps(
  runtime: GenerativeUIRuntime,
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
) {
  const modelData = useModelDataProps(surface, definition, properties);
  const parsedModel = useMemo(
    () => definition.modelProps.safeParse(modelData),
    [definition, modelData],
  );
  const selection = useSelection(
    runtime.manager,
    definition,
    parsedModel.success ? parsedModel.data : undefined,
  );
  return useMemo((): DataProps => {
    if (!parsedModel.success) {
      return { ok: false, problem: issuesOf(parsedModel.error) };
    }
    if (!selection.ok) return selection;
    const parsedBound = definition.boundProps.safeParse(selection.values);
    if (!parsedBound.success) {
      return { ok: false, problem: issuesOf(parsedBound.error) };
    }
    return { ok: true, props: { ...parsedModel.data, ...parsedBound.data } };
  }, [definition, parsedModel, selection]);
}

/**
 * The event props of a node. A matched event (one that matches a declared
 * function) is always bound. An unmatched event is bound only when the model
 * bound it.
 */
function useEventProps(
  runtime: GenerativeUIRuntime,
  surface: ManagedSurface,
  componentId: string,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
) {
  const latest = useRef(properties);
  latest.current = properties;
  const boundNames = Object.keys(definition.events ?? {})
    .filter(
      (name) =>
        Object.hasOwn(definition.eventFunctions, name) ||
        isActionBinding(properties[name]),
    )
    .join("|");
  return useMemo(() => {
    const handlers: Record<
      string,
      (args?: unknown) => Promise<GenerativeUIInvokeResult>
    > = {};
    const names = boundNames ? boundNames.split("|") : [];
    for (const name of names) {
      const call = {
        runtime,
        surface,
        componentId,
        name,
        parameters: definition.events?.[name]?.parameters,
      };
      const functionName = Object.hasOwn(definition.eventFunctions, name)
        ? definition.eventFunctions[name]
        : undefined;
      handlers[name] =
        functionName === undefined
          ? (args) =>
              invokeBoundEvent({
                ...call,
                binding: latest.current[name] as GenerativeUIActionBinding,
                args,
              })
          : (args) => invokeMatchedEvent({ ...call, functionName, args });
    }
    return handlers;
  }, [boundNames, runtime, surface, componentId, definition]);
}

function useSlotProps(
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
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
  definition: ResolvedGenerativeUIComponent;
  properties: Record<string, unknown>;
  runtime: GenerativeUIRuntime;
  ancestors: readonly string[];
}) {
  const dataProps = useDataProps(runtime, surface, definition, properties);
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
  const problem = dataProps.ok ? undefined : dataProps.problem;

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

  if (!dataProps.ok) {
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
      <Component {...dataProps.props} {...eventProps} {...slotProps} />
    </GenerativeUINodeContext.Provider>
  );
}
