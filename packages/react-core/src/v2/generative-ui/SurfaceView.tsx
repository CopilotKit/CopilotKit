import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ComponentModel, SurfaceModel } from "@a2ui/web_core/state";
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
import {
  joinPath,
  resolvePath,
  tryResolveDynamicValue,
} from "@copilotkit/core/generative-ui";
import {
  formatIssues,
  hasOwnKey,
  isAsyncIssue,
  issueKey,
  validateSchemaSync,
  withoutRejectedNulls,
} from "@copilotkit/shared/generative-ui";
import {
  createFailureLog,
  failureSlots,
  GenerativeUIFailureLogContext,
  GuardedNodeFallback,
  NodeBoundary,
  NodePlaceholder,
  SurfaceBoundary,
  toError,
  useFailureLog,
} from "./boundaries";
import type { GenerativeUIFailureLog } from "./boundaries";
import { useGenerativeUIHost } from "./host";
import {
  accessibilityAttributes,
  readAccessibility,
  wrapperAria,
} from "./accessibility";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import {
  invokeBoundEvent,
  invokeMatchedEvent,
} from "@copilotkit/core/generative-ui";
import {
  GenerativeUINodeContext,
  reportErrorSafely,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import type {
  GenerativeUISurfaceManager,
  ManagedSurface,
} from "@copilotkit/core/generative-ui";

const NO_ANCESTORS: readonly string[] = [];
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
  // The host draws the root (on the web, a DOM element that carries the
  // theme's stylesheet). It is always there, so a theme change does not
  // remount the surface.
  const { SurfaceRoot } = useGenerativeUIHost();
  // A failed surface tries again with new content, as a failed node does
  // with new props. New content is a new operation applied: the manager
  // gives `surface.operations` a new array on every ingest, also one that
  // delivers the same operations again (a replay, a status change), so its
  // identity would retry (and report again) on every chunk. The count of
  // applied operations grows only with new ones, and an ingest that does
  // not extend them rebuilds the surface as a new object.
  const appliedCount = useSyncExternalStore(
    runtime.manager.subscribe,
    () => surface.operations.length,
    undefinedSnapshot,
  );
  const revision = useMemo(
    () => ({ surface, appliedCount }),
    [surface, appliedCount],
  );
  // What this surface reported, so that a failure that stays the same is
  // reported once, not on each revision. The log belongs to the surface:
  // a named target can show another surface in the same view, and that
  // surface's failures are its own, even the same error at the same place.
  const [scopedLog, setScopedLog] = useState(() => ({
    key: surface.key,
    log: createFailureLog(),
  }));
  let failureLog = scopedLog.log;
  if (scopedLog.key !== surface.key) {
    const next = { key: surface.key, log: createFailureLog() };
    setScopedLog(next);
    failureLog = next.log;
  }
  // A place that unmounted and did not mount again before new content of
  // this surface arrived went away: forget what it reported (see
  // GenerativeUIFailureLog). New content is a new applied operation
  // (`appliedCount` grows) or a rebuilt surface (a new object). The manager
  // also notifies for every other surface, for ingests that bring nothing
  // new, for `setState` and for target changes, none of which is new content
  // of this one; the user's data-model writes do not notify it at all.
  //
  // What the view last saw outlives the subscription: <Activity> disconnects
  // it while the surface is hidden, and content that arrived meanwhile is
  // settled as missed when the surface is shown again (the boundaries have
  // retained their slots by then). A layout effect, so that this runs before
  // the nodes' effects report their failures again.
  const { threadId, surfaceId } = surface;
  const { manager } = runtime;
  const seen = useRef<
    | { log: GenerativeUIFailureLog; current: unknown; applied: unknown }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const contentOf = () => {
      const current = manager.getSurface(threadId, surfaceId);
      return { log: failureLog, current, applied: current?.operations.length };
    };
    const observe = (missed: boolean) => {
      const last = seen.current;
      const next = contentOf();
      seen.current = next;
      if (
        last?.log === failureLog &&
        (next.current !== last.current || next.applied !== last.applied)
      ) {
        failureLog.settle(missed);
      }
    };
    observe(true);
    return manager.subscribe(() => observe(false));
  }, [manager, threadId, surfaceId, failureLog]);
  // Two boundaries. The inner one sits inside the root, so a failed surface
  // keeps the root and its theme (on the web, the same output as before the
  // host existed). The outer one catches what the host's root throws itself,
  // which must not reach the chat or the host page, and offers Retry.
  return (
    <GenerativeUIFailureLogContext.Provider value={failureLog}>
      <SurfaceBoundary
        surfaceId={surface.surfaceId}
        runtime={runtime}
        log={failureLog}
        level="outer"
        revision={revision}
        retryable
      >
        <SurfaceRoot surfaceId={surface.surfaceId} theme={runtime.theme}>
          <SurfaceBoundary
            surfaceId={surface.surfaceId}
            runtime={runtime}
            log={failureLog}
            level="inner"
            revision={revision}
          >
            <NodeView
              surface={surface}
              componentId={GENERATIVE_UI_ROOT_ID}
              basePath={undefined}
              ancestors={NO_ANCESTORS}
              parentPlace=""
              via=""
            />
          </SurfaceBoundary>
        </SurfaceRoot>
      </SurfaceBoundary>
    </GenerativeUIFailureLogContext.Provider>
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
  // Quoted, so that an id or a path that holds the separators of a place
  // (`/`, `:`, `#`) cannot read as the place of another node.
  const item = basePath === undefined ? "" : JSON.stringify(basePath);
  return `${item}#${JSON.stringify(componentId)}`;
}

/**
 * Where one rendered copy of a node is: the place of its parent, the slot
 * or child reference of the parent it renders in, and its scoped id. Names
 * the node's failure-log slots. A scoped id alone is not enough: the same
 * id can render under two parents, and a cyclic reference repeats the
 * scoped id of an ancestor. Each copy keeps its own memory of what it
 * reported, so one copy that renders, goes away or remounts does not clear
 * the memory of another that still fails.
 */
function placeOf(parentPlace: string, via: string, position: string) {
  return `${parentPlace}/${via === "" ? "" : JSON.stringify(via)}${position}`;
}

const NodeView = memo(function NodeView({
  surface,
  componentId,
  basePath,
  ancestors,
  parentPlace,
  via,
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
  /** The place of the parent (see `placeOf`); "" for the root. */
  parentPlace: string;
  /** The slot or child reference of the parent this node renders in. */
  via: string;
}) {
  const runtime = useRequiredGenerativeUIRuntime();
  const log = useFailureLog();
  const component = useComponentModel(
    runtime.manager,
    surface.model,
    componentId,
  );
  const properties = useComponentProperties(runtime.manager, component);
  const position = scopedId(componentId, basePath);
  const place = placeOf(parentPlace, via, position);
  // A node that goes away takes the memory of its failures with it, so the
  // same failure in a node added later is reported. A node that only
  // remounts (StrictMode, <Activity>, an ancestor that remounts) keeps it:
  // the log forgets a slot let go of only once new content arrives.
  useEffect(() => {
    const slots = [
      failureSlots.fallback(place),
      failureSlots.cycle(place),
      failureSlots.props(place),
    ];
    for (const slot of slots) log.retain(slot);
    return () => {
      for (const slot of slots) log.release(slot);
    };
  }, [log, place]);
  // The fallbacks below get another chance with a new message or a new
  // revision of the node (`properties`): nothing above them remounts them.
  if (ancestors.includes(position)) {
    return (
      <GuardedNodeFallback
        surfaceId={surface.surfaceId}
        componentId={componentId}
        runtime={runtime}
        message={`cyclic reference to ${componentId}`}
        slot={failureSlots.cycle(place)}
        revision={properties}
      />
    );
  }
  if (!component || !properties)
    return <NodePlaceholder componentId={componentId} />;
  const definition = runtime.ui.components.get(component.type);
  if (!definition) {
    return (
      <GuardedNodeFallback
        surfaceId={surface.surfaceId}
        componentId={componentId}
        runtime={runtime}
        message={`unknown component "${component.type}"`}
        slot={failureSlots.fallback(place)}
        revision={properties}
      />
    );
  }
  return (
    <NodeBoundary
      key={component.type}
      surfaceId={surface.surfaceId}
      componentId={componentId}
      place={place}
      revision={properties}
      runtime={runtime}
      log={log}
    >
      <ResolvedNode
        surface={surface}
        componentId={componentId}
        definition={definition}
        properties={properties}
        runtime={runtime}
        basePath={basePath}
        ancestors={ancestors}
        place={place}
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
  parentPlace,
  via,
}: {
  surface: ManagedSurface;
  template: GenerativeUITemplateChildren;
  basePath: string | undefined;
  ancestors: readonly string[];
  parentPlace: string;
  via: string;
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
          parentPlace={parentPlace}
          via={via}
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
 * `{"@call":"@index"}` in a template, at any depth. Bound props, events and
 * slots are left out, and so are the keys of the A2UI component envelope;
 * `accessibility` is resolved the same way and given on its own.
 *
 * A writable prop that is not bound to a path and that the component set
 * shows the local value from `overrides`, also when the model never set the
 * prop. That is intended: the user's edit wins over the model's literal
 * value, also over a newer literal the agent sends later, until the node
 * remounts. A literal is not data the agent and the user share; a prop
 * that both must write is bound to a path, and the setter writes the data
 * model.
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
        hasOwnKey(definition.selectors, key) ||
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
      const { message } = toError(error);
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
 * The selectors get the checked model props: the resolved values that
 * passed the props schema (without the nulls it rejected), not the
 * schema's parsed output, so its defaults and transforms are not applied
 * yet. They run again only when the state object or those props change. When the new values are shallow-equal to the last ones, the
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
 * after the selectors reports. The exception is the issue that an async
 * props schema gives (`isAsyncIssue`): the render checks props
 * synchronously only, so the full check would fail the same way, and it is
 * reported here.
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
        : !hasOwnKey(definition.selectors, key);
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
        hasOwnKey(definition.eventFunctions, name) ||
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
      const functionName = hasOwnKey(definition.eventFunctions, name)
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
 * local value of this mounted node that wins over the model's value until
 * the node remounts (see `useModelDataProps`). The setters keep their
 * identity.
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
          const { message } = toError(cause);
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
  place: string,
) {
  return useMemo(() => {
    const childAncestors = [...ancestors, scopedId(componentId, basePath)];
    const slots: Record<string, ReactNode> = {};
    for (const [name, kind] of Object.entries(definition.slots ?? {})) {
      const value = properties[name];
      const via = `${name}:`;
      if (kind === "single" && typeof value === "string") {
        slots[name] = (
          <NodeView
            surface={surface}
            componentId={value}
            basePath={basePath}
            ancestors={childAncestors}
            parentPlace={place}
            via={via}
          />
        );
      } else if (kind === "multiple" && isTemplateChildren(value)) {
        slots[name] = (
          <TemplateChildren
            surface={surface}
            template={value}
            basePath={basePath}
            ancestors={childAncestors}
            parentPlace={place}
            via={via}
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
            parentPlace={place}
            via={via}
          />
        ));
      }
    }
    return slots;
  }, [
    surface,
    definition,
    properties,
    componentId,
    basePath,
    ancestors,
    place,
  ]);
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
  place: string,
) {
  return useMemo(() => {
    if (props === undefined || refs.length === 0) return props;
    const childAncestors = [...ancestors, scopedId(componentId, basePath)];
    const render = (
      kind: ChildRef["kind"],
      value: unknown,
      via: string,
    ): unknown => {
      if (kind === "single") {
        return typeof value === "string" ? (
          <NodeView
            surface={surface}
            componentId={value}
            basePath={basePath}
            ancestors={childAncestors}
            parentPlace={place}
            via={via}
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
            parentPlace={place}
            via={via}
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
          parentPlace={place}
          via={via}
        />
      ));
    };
    let result: unknown = props;
    for (const ref of refs) {
      // A path through an array (`"*"`) finds a reference in each item;
      // they are told apart by their order.
      let found = 0;
      const path = ref.path.join(".");
      result = mapAtChildRef(result, ref.path, (value) =>
        render(ref.kind, value, `${path}[${found++}]:`),
      );
    }
    return result as Record<string, unknown>;
  }, [surface, refs, props, componentId, basePath, ancestors, place]);
}

function ResolvedNode({
  surface,
  componentId,
  definition,
  properties,
  runtime,
  basePath,
  ancestors,
  place,
}: {
  surface: ManagedSurface;
  componentId: string;
  definition: ResolvedGenerativeUIComponent;
  properties: Record<string, unknown>;
  runtime: GenerativeUIRuntime;
  basePath: string | undefined;
  ancestors: readonly string[];
  /** Where this copy of the node is (see `placeOf`). */
  place: string;
}) {
  const { AccessibilityWrapper } = useGenerativeUIHost();
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
    place,
  );
  const childRefProps = useChildRefProps(
    surface,
    definition.childRefs,
    dataProps.ok ? dataProps.props : undefined,
    componentId,
    basePath,
    ancestors,
    place,
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
  const log = useFailureLog();

  // The node renders: a fallback that failed in its place before (invalid
  // props, an unknown type, a cycle) is a new failure if it fails again,
  // and so are invalid props.
  useEffect(() => {
    if (!problem) {
      log.clear(failureSlots.fallback(place));
      log.clear(failureSlots.props(place));
    }
  }, [problem, log, place]);

  // Through the failure log, so that the same problem is reported once,
  // also when this node remounts (a new type, a boundary that resets).
  useEffect(() => {
    if (problem) {
      log.report(runtime, failureSlots.props(place), {
        kind: "props",
        surfaceId: surface.surfaceId,
        componentId,
        error: new Error(`Invalid props: ${problem}`),
      });
    }
  }, [problem, log, place, runtime, surface.surfaceId, componentId]);

  if (!dataProps.ok) {
    return (
      <GuardedNodeFallback
        surfaceId={surface.surfaceId}
        componentId={componentId}
        runtime={runtime}
        message={`invalid props (${problem})`}
        slot={failureSlots.fallback(place)}
        revision={properties}
      />
    );
  }
  const Component = definition.component;
  const rendered = (
    <Component {...childRefProps} {...eventProps} {...slotProps} {...setters} />
  );
  // The hidden state and the live region of the envelope apply to every
  // component here, in the host's AccessibilityWrapper (on the web, a span
  // with no box of its own). A label or a description needs an element with
  // a role, so the component sets those itself (the standard ones do; see
  // useGenerativeUIAccessibility).
  //
  // The wrapper is there whenever the component has an envelope, whatever
  // its values, so a bound `hidden` that flips does not remount the
  // component and lose what the user typed into it. A component that applies
  // the envelope itself (`accessibility: "self"`) gets no wrapper: a table
  // row or cell cannot sit in one.
  //
  // A component sent again with an envelope added or removed does remount.
  // On the web, a wrapper on every node would break the stylesheet's child
  // selectors (table rows and cells, the last text of a spaceBetween row),
  // and bound inputs keep their values in the data model anyway.
  const hasEnvelope =
    properties.accessibility !== undefined &&
    definition.accessibility !== "self";
  return (
    <GenerativeUINodeContext.Provider value={nodeContext}>
      {hasEnvelope ? (
        <AccessibilityWrapper
          attributes={wrapperAria(accessibilityAttributes(accessibility))}
        >
          {rendered}
        </AccessibilityWrapper>
      ) : (
        rendered
      )}
    </GenerativeUINodeContext.Provider>
  );
}
