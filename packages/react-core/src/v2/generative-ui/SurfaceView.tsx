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
  A2UI_COMPONENT_ENVELOPE_KEYS,
  GENERATIVE_UI_ROOT_ID,
  isActionBinding,
  isPathBinding,
  mapAtChildRef,
} from "@copilotkit/shared";
import type {
  ChildRef,
  GenerativeUIActionBinding,
  GenerativeUITemplateChildren,
} from "@copilotkit/shared";
import { shallowEqual } from "../lib/shallow-stable-ref";
import { setterNameOf } from "./catalog";
import type { ResolvedGenerativeUIComponent } from "./catalog";
import { joinPath, resolvePath, tryResolveDynamicValue } from "./resolve";
import {
  formatIssues,
  isAsyncIssue,
  issueKey,
  validateSchemaSync,
  withoutRejectedNulls,
} from "@copilotkit/shared/generative-ui";
import {
  DefaultNodeFallback,
  NodeBoundary,
  NodePlaceholder,
  SurfaceBoundary,
} from "./boundaries";
import {
  accessibilityAttributes,
  readAccessibility,
  wrapperAria,
} from "./accessibility";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
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

/** What one data prop resolved to, and what it read to get there. */
interface ResolvedProp {
  /** The raw prop value it was resolved from. */
  raw: unknown;
  /** The template item path it was resolved in. */
  basePath: string | undefined;
  /** The value, or the reason it could not be computed. */
  outcome: { ok: true; value: unknown } | { ok: false; message: string };
  /** The data model value at each path it read, when it was resolved. */
  reads: Map<string, unknown>;
}

type ModelData =
  | {
      ok: true;
      values: Record<string, unknown>;
      /** The resolved `accessibility` of the component envelope. */
      accessibility: GenerativeUIAccessibility | undefined;
    }
  | { ok: false; problem: string };

/**
 * The props the model sets, with their dynamic values resolved from the
 * surface data model: `{"@path"}` bindings, `{"@call"}` function values and
 * `{"@call":"@index"}` in a template, at any depth. A literal writable prop
 * that the component set shows the local value from `overrides`. Bound
 * props, events and slots are left out, and so are the keys of the A2UI
 * component envelope; `accessibility` is resolved the same way and given
 * on its own.
 *
 * A prop is resolved again only when its raw value or a data model value it
 * read has changed, so the result keeps its identity otherwise. A function
 * value that cannot be computed gives a problem instead of values.
 */
function useModelDataProps(
  surface: ManagedSurface,
  definition: ResolvedGenerativeUIComponent,
  properties: Record<string, unknown>,
  basePath: string | undefined,
  overrides: Record<string, unknown>,
): ModelData {
  const dataModel = surface.model.dataModel;
  // The units to resolve: each model prop, and each field of the envelope's
  // `accessibility` on its own, so a label that cannot be computed does not
  // take the other fields with it.
  const units = useMemo(() => {
    const list: Array<{ key: string; raw: unknown; field?: string }> = [];
    for (const key of Object.keys(properties)) {
      if (
        definition.events?.[key] ||
        definition.slots?.[key] ||
        Object.hasOwn(definition.selectors, key) ||
        A2UI_COMPONENT_ENVELOPE_KEYS.has(key)
      ) {
        continue;
      }
      list.push({ key, raw: properties[key] });
    }
    const a11y = properties.accessibility;
    if (typeof a11y === "object" && a11y !== null && !Array.isArray(a11y)) {
      for (const [field, raw] of Object.entries(a11y)) {
        list.push({ key: `accessibility/${field}`, raw, field });
      }
    }
    return list;
  }, [properties, definition]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const cache = useRef(new Map<string, ResolvedProp>());
  const values: Record<string, unknown> = {};
  const a11yValues: Record<string, unknown> = {};
  const paths = new Set<string>();
  let problem: string | undefined;
  const next = new Map<string, ResolvedProp>();
  for (const { key, raw, field } of units) {
    const cached = cache.current.get(key);
    // A cached resolution holds while the raw prop, the template item and
    // every value it read are the same. A data model notification clears
    // the cache (below), because web_core changes lists and objects in
    // place, so a changed item inside one keeps the identity of the list.
    const isFresh =
      cached !== undefined &&
      cached.raw === raw &&
      cached.basePath === basePath &&
      [...cached.reads].every(([path, value]) =>
        Object.is(dataModel.get(path), value),
      );
    const resolve = (): ResolvedProp => {
      const resolved = tryResolveDynamicValue(
        raw,
        { data: dataModel, basePath },
        { isChecks: key === "checks" },
      );
      // The reads are kept also when the resolution failed, so the node
      // stays subscribed to the data that can fix it.
      const reads = new Map<string, unknown>();
      for (const path of resolved.paths) reads.set(path, dataModel.get(path));
      return {
        raw,
        basePath,
        reads,
        outcome: resolved.ok
          ? { ok: true, value: resolved.value }
          : { ok: false, message: resolved.error.message },
      };
    };
    const entry = isFresh && cached ? cached : resolve();
    next.set(key, entry);
    if (field !== undefined) {
      // The envelope is not a prop: a label that cannot be computed names
      // nothing, and the component is not at fault for it. Its reads stay
      // subscribed, so the data that fixes it brings the label.
      if (entry.outcome.ok) a11yValues[field] = entry.outcome.value;
    } else if (entry.outcome.ok) values[key] = entry.outcome.value;
    else problem ??= `${key}: ${entry.outcome.message}`;
    for (const path of entry.reads.keys()) paths.add(path);
  }
  cache.current = next;
  const accessibility = readAccessibility(a11yValues);
  for (const [key, value] of Object.entries(overrides)) {
    if (!isPathBinding(properties[key])) values[key] = value;
  }
  // The values this render was based on, so the effect can detect a write that
  // landed between render and subscription (web_core never replays the current
  // value on subscribe).
  const rendered = useRef(next);
  rendered.current = next;
  const pathKey = [...paths].sort().join("\n");
  useEffect(() => {
    const list = pathKey === "" ? [] : pathKey.split("\n");
    const onChange = () => {
      cache.current = new Map();
      rerender();
    };
    const subscriptions = list.map((path) =>
      dataModel.subscribe(path, onChange),
    );
    const isStale = [...rendered.current.values()].some((entry) =>
      [...entry.reads].some(
        ([path, value]) => !Object.is(dataModel.get(path), value),
      ),
    );
    if (isStale) rerender();
    return () => subscriptions.forEach((s) => s.unsubscribe());
  }, [dataModel, pathKey]);
  const stable = useRef<ModelData>({
    ok: true,
    values: {},
    accessibility: undefined,
  });
  const result: ModelData =
    problem === undefined
      ? { ok: true, values, accessibility }
      : { ok: false, problem };
  const last = stable.current;
  const isSame =
    result.ok && last.ok
      ? shallowEqual(last.values, result.values) &&
        shallowEqual(
          (last.accessibility ?? {}) as Record<string, unknown>,
          (result.accessibility ?? {}) as Record<string, unknown>,
        )
      : !result.ok && !last.ok && last.problem === result.problem;
  if (!isSame) stable.current = result;
  return stable.current;
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
  | {
      ok: true;
      props: Record<string, unknown>;
      accessibility: GenerativeUIAccessibility | undefined;
    }
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
  let values = modelData;
  let result = validateSchemaSync(definition.props, values);
  if (!result.success) {
    // A null the schema rejects is an unset prop: check again without it.
    const unset = withoutRejectedNulls(values, result.issues);
    if (unset) {
      values = unset;
      result = validateSchemaSync(definition.props, values);
    }
  }
  if (!result.success) {
    const issues = result.issues.filter((issue) => {
      const key = issueKey(issue);
      return key === undefined
        ? isAsyncIssue(issue)
        : !Object.hasOwn(definition.selectors, key);
    });
    if (issues.length > 0) return { ok: false, problem: formatIssues(issues) };
  }
  return { ok: true, values };
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
    () =>
      modelData.ok ? checkModelProps(definition, modelData.values) : modelData,
    [definition, modelData],
  );
  const selection = useSelection(
    runtime.manager,
    definition,
    modelCheck.ok ? modelCheck.values : undefined,
  );
  const accessibility = modelData.ok ? modelData.accessibility : undefined;
  return useMemo((): DataProps => {
    if (!modelCheck.ok) return modelCheck;
    if (!selection.ok) return selection;
    if (!definition.props) return { ok: true, props: {}, accessibility };
    const input = { ...modelCheck.values, ...selection.values };
    let parsed = validateSchemaSync(definition.props, input);
    if (!parsed.success) {
      // A null the schema rejects is an unset prop: validate without it.
      const unset = withoutRejectedNulls(input, parsed.issues);
      if (unset) parsed = validateSchemaSync(definition.props, unset);
    }
    if (!parsed.success) {
      return { ok: false, problem: formatIssues(parsed.issues) };
    }
    return {
      ok: true,
      props: parsed.data as Record<string, unknown>,
      accessibility,
    };
  }, [definition, modelCheck, selection, accessibility]);
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
                binding: latest.current[name] as GenerativeUIActionBinding,
                basePath,
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

/**
 * The parsed data props with every typed child reference (`child()`,
 * `childList()`, at any depth) replaced by the rendered component. Without
 * references, the parsed props come back as they are.
 */
function useChildRefProps(
  surface: ManagedSurface,
  refs: readonly ChildRef[],
  props: Record<string, unknown> | undefined,
  componentId: string,
  basePath: string | undefined,
  ancestors: readonly string[],
) {
  return useMemo(() => {
    if (props === undefined || refs.length === 0) return props;
    const childAncestors = [...ancestors, scopedId(componentId, basePath)];
    const render = (kind: ChildRef["kind"], value: unknown): unknown => {
      if (kind === "single") {
        return typeof value === "string" ? (
          <NodeView
            surface={surface}
            componentId={value}
            basePath={basePath}
            ancestors={childAncestors}
          />
        ) : undefined;
      }
      if (isTemplateChildren(value)) {
        return (
          <TemplateChildren
            surface={surface}
            template={value}
            basePath={basePath}
            ancestors={childAncestors}
          />
        );
      }
      if (!Array.isArray(value)) return undefined;
      const ids = [
        ...new Set(value.filter((id): id is string => typeof id === "string")),
      ];
      return ids.map((id) => (
        <NodeView
          key={id}
          surface={surface}
          componentId={id}
          basePath={basePath}
          ancestors={childAncestors}
        />
      ));
    };
    let result: unknown = props;
    for (const ref of refs) {
      result = mapAtChildRef(result, ref.path, (found) =>
        render(ref.kind, found),
      );
    }
    return result as Record<string, unknown>;
  }, [surface, refs, props, componentId, basePath, ancestors]);
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
  const childRefProps = useChildRefProps(
    surface,
    definition.childRefs,
    dataProps.ok ? dataProps.props : undefined,
    componentId,
    basePath,
    ancestors,
  );
  const accessibility = dataProps.ok ? dataProps.accessibility : undefined;
  const nodeContext = useMemo(
    () => ({
      surfaceKey: surface.key,
      surfaceId: surface.surfaceId,
      componentId,
      accessibility,
    }),
    [surface.key, surface.surfaceId, componentId, accessibility],
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
  const rendered = (
    <Component {...childRefProps} {...eventProps} {...slotProps} {...setters} />
  );
  // The hidden state and the live region of the envelope apply to every
  // component here, in a wrapper with no box of its own. A label or a
  // description needs an element with a role, so the component sets those
  // itself (the standard ones do; see useGenerativeUIAccessibility). The
  // wrapper is there whenever the component has an envelope (unless the
  // component applies the envelope itself: a table row or cell cannot sit
  // in a span), whatever its values: a bound `hidden` that flips must not remount the component and
  // lose what the user typed into it. A component that is sent again with
  // an envelope added or removed does remount: a wrapper on every node
  // would break the stylesheet's child selectors (table rows and cells,
  // the last text of a spaceBetween row), and bound inputs keep their
  // values in the data model anyway.
  const hasEnvelope =
    properties.accessibility !== undefined &&
    definition.accessibility !== "self";
  return (
    <GenerativeUINodeContext.Provider value={nodeContext}>
      {hasEnvelope ? (
        <span
          data-a2ui-accessibility=""
          style={ROOT_STYLE}
          {...wrapperAria(accessibilityAttributes(accessibility))}
        >
          {rendered}
        </span>
      ) : (
        rendered
      )}
    </GenerativeUINodeContext.Provider>
  );
}
