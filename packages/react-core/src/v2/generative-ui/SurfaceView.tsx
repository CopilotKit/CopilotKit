import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ComponentModel, SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  GENERATIVE_UI_ROOT_ID,
  isActionBinding,
  isIndexCall,
  isPathBinding,
} from "@copilotkit/shared";
import type {
  GenerativeUIActionBinding,
  GenerativeUITemplateChildren,
} from "@copilotkit/shared";
import { shallowEqual, useShallowStableRef } from "../lib/shallow-stable-ref";
import { setterNameOf } from "./catalog";
import type { ResolvedGenerativeUIComponent } from "./catalog";
import {
  formatIssues,
  isAsyncIssue,
  issueKey,
  validateSchemaSync,
} from "./schema";
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
import { themeStyleSheet } from "./theme";
import type {
  GenerativeUISurfaceManager,
  ManagedSurface,
} from "./surface-manager";

const NO_ANCESTORS: readonly string[] = [];
const ROOT_STYLE = { display: "contents" } as const;
// No surface state exists on the server or during hydration.
const undefinedSnapshot = () => undefined;
const noopSubscribe = () => () => {};
const zeroSnapshot = () => 0;

/** Adds one segment to a JSON pointer: ("/items", "0") gives "/items/0". */
function joinPath(base: string, segment: string) {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}

/**
 * The absolute data model path of a binding. A path without a leading "/"
 * is relative to the current template item, or to the root outside of a
 * template.
 */
function resolvePath(path: string, basePath: string | undefined) {
  if (path.startsWith("/")) return path;
  return joinPath(basePath ?? "/", path);
}

/** A `{"@path"}` value with its path made absolute. Other values stay. */
function absoluteValue<T>(value: T, basePath: string | undefined) {
  if (!isPathBinding(value)) return value;
  return { "@path": resolvePath(value["@path"], basePath) };
}

/** `{"@path"}` values with their paths made absolute. */
function absoluteValues(
  values: Record<string, unknown> | undefined,
  basePath: string | undefined,
) {
  if (values === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      absoluteValue(value, basePath),
    ]),
  );
}

/**
 * An event binding whose `{"@path"}` args, user message, and context are
 * absolute.
 */
function absoluteBinding(
  binding: GenerativeUIActionBinding,
  basePath: string | undefined,
) {
  if ("functionCall" in binding) {
    const { functionCall } = binding;
    const args = absoluteValues(functionCall.args, basePath);
    return { functionCall: { ...functionCall, args } };
  }
  const { event } = binding;
  const userMessage = absoluteValue(event.userMessage, basePath);
  const context = absoluteValues(event.context, basePath);
  return { event: { ...event, userMessage, context } };
}

/**
 * The index of the template item at `basePath`: its last segment. A
 * template gives each item the path `<list>/<index>`. `undefined` outside
 * of a template.
 */
function templateIndex(basePath: string | undefined) {
  if (basePath === undefined) return undefined;
  return Number(basePath.slice(basePath.lastIndexOf("/") + 1));
}

/**
 * The value of a `{"@call":"@index"}` prop: the 0-based index of the
 * template item, plus `args.offset`. `undefined` outside of a template.
 */
function indexValue(
  call: { args?: { offset?: number } },
  basePath: string | undefined,
) {
  const index = templateIndex(basePath);
  if (index === undefined) return undefined;
  return index + (call.args?.offset ?? 0);
}

/** A "multiple" slot value that repeats a component for each list item. */
function isTemplateChildren(
  value: unknown,
): value is GenerativeUITemplateChildren {
  return (
    typeof value === "object" &&
    value !== null &&
    "componentId" in value &&
    typeof value.componentId === "string" &&
    "path" in value &&
    typeof value.path === "string"
  );
}

export function SurfaceView({ surface }: { surface: ManagedSurface }) {
  const runtime = useRequiredGenerativeUIRuntime();
  const { theme } = runtime;
  const sheet = useMemo(() => themeStyleSheet(theme), [theme]);
  // The root element is always there, so a theme change does not remount
  // the surface. `display: contents` keeps it out of the layout, and the
  // CSS variables still reach every component of the surface. The
  // `a2ui-surface` class scopes the standard catalog's surface CSS rules.
  // The theme is a stylesheet, not an inline style, so that its `dark`
  // values can apply in dark mode only. The values are checked in
  // `themeStyleSheet`, and the HTML is set as is, so the server render
  // keeps the quotes of the rule.
  return (
    <div
      className="a2ui-surface"
      data-generative-ui-root={surface.surfaceId}
      data-a2ui-theme={sheet?.id}
      style={ROOT_STYLE}
    >
      {sheet ? <style dangerouslySetInnerHTML={{ __html: sheet.css }} /> : null}
      <SurfaceBoundary surfaceId={surface.surfaceId} runtime={runtime}>
        <NodeView
          surface={surface}
          componentId={GENERATIVE_UI_ROOT_ID}
          basePath={undefined}
          ancestors={NO_ANCESTORS}
        />
      </SurfaceBoundary>
    </div>
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

/**
 * The id of a node in the ancestor list. A template renders the same
 * component once per item, so the item path is part of the id. A real cycle
 * repeats both.
 */
function scopedId(componentId: string, basePath: string | undefined) {
  return `${basePath ?? ""}#${componentId}`;
}

const NodeView = memo(function NodeView({
  surface,
  componentId,
  basePath,
  ancestors,
}: {
  surface: ManagedSurface;
  componentId: string;
  /**
   * The data model path of the template item this node renders, or
   * `undefined` outside of a template. Relative paths resolve against it.
   */
  basePath: string | undefined;
  /** Scoped ids of the nodes above this one; used to cut cyclic references. */
  ancestors: readonly string[];
}) {
  const runtime = useRequiredGenerativeUIRuntime();
  const component = useComponentModel(
    runtime.manager,
    surface.model,
    componentId,
  );
  const properties = useComponentProperties(runtime.manager, component);
  if (ancestors.includes(scopedId(componentId, basePath))) {
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
        basePath={basePath}
        ancestors={ancestors}
      />
    </NodeBoundary>
  );
});

/**
 * Renders the component of a template once for each item of the list at the
 * template path, keyed by index. Renders nothing when there is no list.
 */
function TemplateChildren({
  surface,
  template,
  basePath,
  ancestors,
}: {
  surface: ManagedSurface;
  template: GenerativeUITemplateChildren;
  basePath: string | undefined;
  ancestors: readonly string[];
}) {
  const dataModel = surface.model.dataModel;
  const listPath = resolvePath(template.path, basePath);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = dataModel.subscribe(listPath, onChange);
      return () => subscription.unsubscribe();
    },
    [dataModel, listPath],
  );
  const getCount = () => {
    const list = dataModel.get(listPath);
    return Array.isArray(list) ? list.length : 0;
  };
  const count = useSyncExternalStore(subscribe, getCount, zeroSnapshot);
  const indexes = Array.from({ length: count }, (_, index) => index);
  return (
    <>
      {indexes.map((index) => (
        <NodeView
          key={index}
          surface={surface}
          componentId={template.componentId}
          basePath={joinPath(listPath, String(index))}
          ancestors={ancestors}
        />
      ))}
    </>
  );
}

/**
 * The props the model sets, with `{"@path"}` bindings read from the surface
 * data model, and `{"@call":"@index"}` set to the index of the template
 * item. A literal writable prop that the component set shows the local
 * value from `overrides`. Bound props, events and slots are left out. The
 * result is the same object until a value changes.
 */
function useModelDataProps(
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
  basePath: string | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const dataModel = surface.model.dataModel;
  const entries = useMemo(
    () =>
      Object.entries(properties)
        .filter(
          ([key]) =>
            !definition.events?.[key] &&
            !definition.slots?.[key] &&
            !Object.hasOwn(definition.selectors, key),
        )
        .map(([key, value]) => ({
          key,
          value: isIndexCall(value) ? indexValue(value, basePath) : value,
          path: isPathBinding(value)
            ? resolvePath(value["@path"], basePath)
            : undefined,
        })),
    [properties, definition, basePath],
  );
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const resolved: Record<string, unknown> = {};
  for (const { key, value, path } of entries) {
    resolved[key] = path === undefined ? value : dataModel.get(path);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!isPathBinding(properties[key])) resolved[key] = value;
  }
  // The values this render was based on, so the effect can detect a write that
  // landed between render and subscription (web_core never replays the current
  // value on subscribe).
  const rendered = useRef(resolved);
  rendered.current = resolved;
  useEffect(() => {
    const bound = entries.flatMap(({ key, path }) =>
      path === undefined ? [] : [{ key, path }],
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

type DataProps =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; problem: string };

type ModelCheck =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problem: string };

/**
 * Checks the model-set props with the props schema before the selectors run.
 * The bound props are not set yet, so their issues do not count. Neither do
 * issues with no path (a check over several props), which the full check
 * after the selectors reports.
 */
function checkModelProps(
  definition: ResolvedGenerativeUIComponent,
  modelData: Record<string, unknown>,
): ModelCheck {
  if (!definition.props) return { ok: true, values: {} };
  const result = validateSchemaSync(definition.props, modelData);
  if (!result.success) {
    const issues = result.issues.filter((issue) => {
      const key = issueKey(issue);
      return key === undefined
        ? isAsyncIssue(issue)
        : !Object.hasOwn(definition.selectors, key);
    });
    if (issues.length > 0) return { ok: false, problem: formatIssues(issues) };
  }
  return { ok: true, values: modelData };
}

/**
 * The data props of a node, in three steps: check the model-set props with
 * the props schema, run the selectors with them, then parse all props with
 * the props schema. Gives the reason when a step fails.
 */
function useDataProps(
  runtime: GenerativeUIRuntime,
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
  basePath: string | undefined,
  overrides: Record<string, unknown>,
) {
  const modelData = useModelDataProps(
    surface,
    definition,
    properties,
    basePath,
    overrides,
  );
  const modelCheck = useMemo(
    () => checkModelProps(definition, modelData),
    [definition, modelData],
  );
  const selection = useSelection(
    runtime.manager,
    definition,
    modelCheck.ok ? modelCheck.values : undefined,
  );
  return useMemo((): DataProps => {
    if (!modelCheck.ok) return modelCheck;
    if (!selection.ok) return selection;
    if (!definition.props) return { ok: true, props: {} };
    const parsed = validateSchemaSync(definition.props, {
      ...modelCheck.values,
      ...selection.values,
    });
    if (!parsed.success) {
      return { ok: false, problem: formatIssues(parsed.issues) };
    }
    return { ok: true, props: parsed.data as Record<string, unknown> };
  }, [definition, modelCheck, selection]);
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
  basePath: string | undefined,
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
                binding: absoluteBinding(
                  latest.current[name] as GenerativeUIActionBinding,
                  basePath,
                ),
                args,
              })
          : (args) => invokeMatchedEvent({ ...call, functionName, args });
    }
    return handlers;
  }, [boundNames, runtime, surface, componentId, definition, basePath]);
}

/**
 * The setter props of a node: `setValue` for the writable prop `value`. For
 * a prop the model bound to `{"@path"}`, the setter writes the data model
 * and makes the path user-owned. For a literal prop, it sets `overrides`, a
 * local value of this mounted node. The setters keep their identity.
 */
function useSetterProps(
  runtime: GenerativeUIRuntime,
  surface: ManagedSurface,
  componentId: string,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
  basePath: string | undefined,
) {
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const latest = useRef(properties);
  latest.current = properties;
  const setters = useMemo(() => {
    const result: Record<string, (value: unknown) => void> = {};
    const writable = definition.writable ?? [];
    for (const key of writable) {
      result[setterNameOf(key)] = (value) => {
        const binding = latest.current[key];
        if (!isPathBinding(binding)) {
          setOverrides((current) => ({ ...current, [key]: value }));
          return;
        }
        try {
          runtime.manager.setOwnedValue(
            surface.key,
            resolvePath(binding["@path"], basePath),
            value,
          );
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : String(cause);
          reportErrorSafely(runtime, {
            kind: "props",
            surfaceId: surface.surfaceId,
            componentId,
            error: new Error(`${setterNameOf(key)}: ${message}`),
          });
        }
      };
    }
    return result;
  }, [runtime, surface, componentId, definition, basePath]);
  return { overrides, setters };
}

function useSlotProps(
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
  componentId: string,
  basePath: string | undefined,
  ancestors: readonly string[],
) {
  return useMemo(() => {
    const childAncestors = [...ancestors, scopedId(componentId, basePath)];
    const slots: Record<string, ReactNode> = {};
    for (const [name, kind] of Object.entries(definition.slots ?? {})) {
      const value = properties[name];
      if (kind === "single" && typeof value === "string") {
        slots[name] = (
          <NodeView
            surface={surface}
            componentId={value}
            basePath={basePath}
            ancestors={childAncestors}
          />
        );
      } else if (kind === "multiple" && isTemplateChildren(value)) {
        slots[name] = (
          <TemplateChildren
            surface={surface}
            template={value}
            basePath={basePath}
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
            basePath={basePath}
            ancestors={childAncestors}
          />
        ));
      }
    }
    return slots;
  }, [surface, definition, properties, componentId, basePath, ancestors]);
}

function ResolvedNode({
  surface,
  componentId,
  definition,
  properties,
  runtime,
  basePath,
  ancestors,
}: {
  surface: ManagedSurface;
  componentId: string;
  definition: ResolvedGenerativeUIComponent;
  properties: Record<string, unknown>;
  runtime: GenerativeUIRuntime;
  basePath: string | undefined;
  ancestors: readonly string[];
}) {
  const { overrides, setters } = useSetterProps(
    runtime,
    surface,
    componentId,
    definition,
    properties,
    basePath,
  );
  const dataProps = useDataProps(
    runtime,
    surface,
    definition,
    properties,
    basePath,
    overrides,
  );
  const eventProps = useEventProps(
    runtime,
    surface,
    componentId,
    definition,
    properties,
    basePath,
  );
  const slotProps = useSlotProps(
    surface,
    definition,
    properties,
    componentId,
    basePath,
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
      <Component
        {...dataProps.props}
        {...eventProps}
        {...slotProps}
        {...setters}
      />
    </GenerativeUINodeContext.Provider>
  );
}
