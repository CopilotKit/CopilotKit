import {
  Fragment,
  computed,
  defineComponent,
  h,
  inject,
  provide,
  shallowRef,
  watch,
} from "vue";
import type { ComputedRef, InjectionKey, PropType, Ref, VNode } from "vue";
import {
  A2UI_COMPONENT_ENVELOPE_KEYS,
  GENERATIVE_UI_ROOT_ID,
  isActionBinding,
  isPathBinding,
  mapAtChildRef,
} from "@copilotkit/shared";
import type {
  ChildRef,
  GenerativeUITemplateChildren,
} from "@copilotkit/shared";
import {
  GenerativeUIError,
  formatIssues,
  isAsyncIssue,
  isRecord,
  issueKey,
  validateSchemaSync,
  withoutRejectedNulls,
} from "@copilotkit/shared/generative-ui";
import type {
  AnyGenerativeUI,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
import {
  accessibilityAttributes,
  invokeBoundEvent,
  invokeMatchedEvent,
  joinPath,
  readAccessibility,
  resolvePath,
  tryResolveDynamicValue,
  wrapperAria,
} from "@copilotkit/core/generative-ui";
import type {
  DataModel,
  GenerativeUIAccessibility,
  ManagedSurface,
} from "@copilotkit/core/generative-ui";
import { setterNameOf } from "./catalog";
import type { ResolvedGenerativeUIComponent } from "./catalog";
import {
  DefaultNodeFallback,
  NodeBoundary,
  SurfaceBoundary,
} from "./boundaries";
import { useManagerVersion } from "./hooks";
import {
  GenerativeUINodeKey,
  reportErrorSafely,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
import type {
  GenerativeUINodeContextValue,
  GenerativeUIRuntime,
} from "./runtime-context";
import { useThemeStyleSheet } from "./standard-styles";

const NO_ANCESTORS: readonly string[] = [];
const ROOT_STYLE = { display: "contents" };

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

// ---------------------------------------------------------------------------
// Pure helpers: resolve, check, select and parse the props of a node. The
// same steps as React's SurfaceView and Angular's node-props.ts.
// ---------------------------------------------------------------------------

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => hasOwn(b, key) && a[key] === b[key]);
}

/**
 * A value that a prop resolved to, with a new identity when it is a list or
 * an object. The data model changes lists and objects in place, so a value
 * read straight from it keeps its identity across a change. Vue
 * compares props by identity and would not update the component; the copy
 * makes the change visible. A prop is resolved again only when something
 * changed, so the copy happens only then.
 */
function freshIdentity(value: unknown) {
  if (Array.isArray(value)) return [...value];
  if (isRecord(value)) return { ...value };
  return value;
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

/** The component ids of a list, each once, so keys stay unique. */
function uniqueIds(value: readonly unknown[]) {
  return [
    ...new Set(value.filter((id): id is string => typeof id === "string")),
  ];
}

/**
 * The id of a node in the ancestor list. A template renders the same
 * component once per item, so the item path is part of the id. A real cycle
 * repeats both.
 */
function scopedId(componentId: string, basePath: string | undefined) {
  return `${basePath ?? ""}#${componentId}`;
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

function sameModelData(a: ModelData, b: ModelData) {
  if (a.ok && b.ok) {
    return (
      shallowEqual(a.values, b.values) &&
      shallowEqual({ ...a.accessibility }, { ...b.accessibility })
    );
  }
  return !a.ok && !b.ok && a.problem === b.problem;
}

/**
 * Resolves the props the model sets, with their dynamic values read from the
 * surface data model: `{"@path"}` bindings, `{"@call"}` function values and
 * `{"@call":"@index"}` in a template, at any depth. A literal writable prop
 * that the component set shows the local value from `overrides`. Bound
 * props, events and slots are left out, and so are the keys of the A2UI
 * component envelope; `accessibility` is resolved the same way and given on
 * its own.
 *
 * A prop is resolved again only when its raw value or a data model value it
 * read has changed. `invalidate()` drops the cache: the data model changes
 * lists and objects in place, so a changed item inside one keeps the
 * identity of the list.
 */
class ModelPropsResolver {
  #cache = new Map<string, ResolvedProp>();
  /** The data model paths the last resolution read, sorted and joined. */
  pathKey = "";

  invalidate() {
    this.#cache = new Map();
  }

  /** True when a value read by the last resolution has changed since. */
  isStale(dataModel: DataModel) {
    for (const entry of this.#cache.values()) {
      for (const [path, value] of entry.reads) {
        if (!Object.is(dataModel.get(path), value)) return true;
      }
    }
    return false;
  }

  resolve(
    definition: ResolvedGenerativeUIComponent,
    properties: Record<string, unknown>,
    basePath: string | undefined,
    overrides: Record<string, unknown>,
    dataModel: DataModel,
  ): ModelData {
    // The units to resolve: each model prop, and each field of the envelope's
    // `accessibility` on its own, so a label that cannot be computed does not
    // take the other fields with it.
    const units: Array<{ key: string; raw: unknown; field?: string }> = [];
    for (const key of Object.keys(properties)) {
      const isNotModelProp =
        Boolean(definition.events?.[key]) ||
        Boolean(definition.slots?.[key]) ||
        hasOwn(definition.selectors, key) ||
        A2UI_COMPONENT_ENVELOPE_KEYS.has(key);
      if (isNotModelProp) continue;
      units.push({ key, raw: properties[key] });
    }
    const a11y = properties.accessibility;
    if (isRecord(a11y)) {
      for (const [field, raw] of Object.entries(a11y)) {
        units.push({ key: `accessibility/${field}`, raw, field });
      }
    }
    const values: Record<string, unknown> = {};
    const a11yValues: Record<string, unknown> = {};
    const paths = new Set<string>();
    let problem: string | undefined;
    const next = new Map<string, ResolvedProp>();
    for (const { key, raw, field } of units) {
      const cached = this.#cache.get(key);
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
            ? { ok: true, value: freshIdentity(resolved.value) }
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
    this.#cache = next;
    this.pathKey = [...paths].sort().join("\n");
    for (const [key, value] of Object.entries(overrides)) {
      if (!isPathBinding(properties[key])) values[key] = value;
    }
    if (problem !== undefined) return { ok: false, problem };
    return { ok: true, values, accessibility: readAccessibility(a11yValues) };
  }
}

type Checked =
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
): Checked {
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
        : !hasOwn(definition.selectors, key);
    });
    if (issues.length > 0) return { ok: false, problem: formatIssues(issues) };
  }
  return { ok: true, values };
}

const NO_SELECTION: Checked = { ok: true, values: {} };

function sameChecked(a: Checked, b: Checked) {
  if (a.ok && b.ok) return shallowEqual(a.values, b.values);
  if (!a.ok && !b.ok) return a.problem === b.problem;
  return false;
}

/** Runs every selector of a node. A selector that throws gives a problem. */
function selectBoundProps(
  definition: ResolvedGenerativeUIComponent,
  state: Readonly<Record<string, unknown>>,
  modelProps: Record<string, unknown>,
): Checked {
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

type DataProps =
  | {
      ok: true;
      props: Record<string, unknown>;
      accessibility: GenerativeUIAccessibility | undefined;
    }
  | { ok: false; problem: string };

/** Parses the model props and the selected props together with the props schema. */
function parseDataProps(
  definition: ResolvedGenerativeUIComponent,
  modelValues: Record<string, unknown>,
  selected: Record<string, unknown>,
  accessibility: GenerativeUIAccessibility | undefined,
): DataProps {
  if (!definition.props) return { ok: true, props: {}, accessibility };
  const input = { ...modelValues, ...selected };
  let parsed = validateSchemaSync(definition.props, input);
  if (!parsed.success) {
    // A null the schema rejects is an unset prop: validate without it.
    const unset = withoutRejectedNulls(input, parsed.issues);
    if (unset) parsed = validateSchemaSync(definition.props, unset);
  }
  if (!parsed.success) {
    return { ok: false, problem: formatIssues(parsed.issues) };
  }
  // A props schema is an object schema, so its output is a record.
  const props = isRecord(parsed.data) ? parsed.data : {};
  return { ok: true, props, accessibility };
}

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------

/**
 * A computed that keeps its last value while `isSame` says the new one is
 * equal, so the effects that read it do not run again.
 */
function stableComputed<T>(getter: () => T, isSame: (a: T, b: T) => boolean) {
  let last: { value: T } | undefined;
  return computed(() => {
    const next = getter();
    if (last && isSame(last.value, next)) return last.value;
    last = { value: next };
    return next;
  });
}

/** The manager version of the surface, shared by all its nodes. */
const SurfaceVersionKey: InjectionKey<Readonly<Ref<number>>> = Symbol(
  "GenerativeUISurfaceVersion",
);

/** The manager version that SurfaceView provides, or a version of its own. */
function useSurfaceVersion(runtime: ComputedRef<GenerativeUIRuntime>) {
  return inject(SurfaceVersionKey, () => useManagerVersion(runtime), true);
}

/**
 * A counter that goes up when the data model changes at one of the paths
 * of `pathKey` (paths joined with "\n"). Read it in a render to render
 * again on such a change.
 */
function useDataPathsVersion(
  dataModel: () => DataModel,
  pathKey: () => string,
) {
  const version = shallowRef(0);
  watch(
    [dataModel, pathKey],
    ([model, key], _previous, onCleanup) => {
      const paths = key === "" ? [] : key.split("\n");
      const subscriptions = paths.map((path) =>
        model.subscribe(path, () => {
          version.value++;
        }),
      );
      onCleanup(() => {
        for (const subscription of subscriptions) subscription.unsubscribe();
      });
    },
    { immediate: true },
  );
  return version;
}

/**
 * What the engine functions need from the runtime. The engine types `ui`
 * with function and class components; it never reads the components.
 */
function engineOf(runtime: GenerativeUIRuntime) {
  const ui: AnyGenerativeUI = runtime.ui;
  return {
    manager: runtime.manager,
    dispatcher: runtime.dispatcher,
    forwardEvent: runtime.forwardEvent,
    reportError: runtime.reportError,
    ui,
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Where a node renders: which component of which surface, in which template item. */
const nodeProps = {
  surface: { type: Object as PropType<ManagedSurface>, required: true },
  componentId: { type: String, required: true },
  /**
   * The data model path of the template item this node renders, or
   * `undefined` outside of a template. Relative paths resolve against it.
   */
  basePath: { type: String, default: undefined },
  /** Scoped ids of the nodes above this one; used to cut cyclic references. */
  ancestors: { type: Array as PropType<readonly string[]>, required: true },
} as const;

/**
 * The VNodes of a template: the component once for each item of the list at
 * the template path, keyed by index. None when there is no list.
 */
function templateItems(
  surface: ManagedSurface,
  template: GenerativeUITemplateChildren,
  basePath: string | undefined,
  ancestors: readonly string[],
): VNode[] {
  const listPath = resolvePath(template.path, basePath);
  const list = surface.model.dataModel.get(listPath);
  const count = Array.isArray(list) ? list.length : 0;
  return Array.from({ length: count }, (_, index) =>
    h(NodeView, {
      key: index,
      surface,
      componentId: template.componentId,
      basePath: joinPath(listPath, String(index)),
      ancestors,
    }),
  );
}

/**
 * Renders the component of a template once for each item of the list at the
 * template path, and follows the length of the list. Used for a template in
 * a `childList()` prop, which the component gets as one VNode.
 */
const TemplateChildren = defineComponent({
  name: "GenerativeUITemplateChildren",
  props: {
    surface: nodeProps.surface,
    template: {
      type: Object as PropType<GenerativeUITemplateChildren>,
      required: true,
    },
    basePath: nodeProps.basePath,
    ancestors: nodeProps.ancestors,
  },
  setup(props) {
    const runtime = useRequiredGenerativeUIRuntime();
    const version = useSurfaceVersion(runtime);
    const dataModel = computed(() => {
      void version.value;
      return props.surface.model.dataModel;
    });
    const listVersion = useDataPathsVersion(
      () => dataModel.value,
      () => resolvePath(props.template.path, props.basePath),
    );
    return () => {
      void listVersion.value;
      return h(
        Fragment,
        templateItems(
          props.surface,
          props.template,
          props.basePath,
          props.ancestors,
        ),
      );
    };
  },
});

/**
 * One node of a surface, with a component that the model may not have sent
 * yet. A node that has not streamed yet renders nothing: each component
 * appears as soon as it is complete.
 */
const NodeView = defineComponent({
  name: "GenerativeUINodeView",
  props: nodeProps,
  setup(props) {
    const runtime = useRequiredGenerativeUIRuntime();
    const version = useSurfaceVersion(runtime);
    // The manager notifies once an ingest is fully applied. The computeds
    // keep their value when the model or its props did not change, so the
    // node renders again only for its own changes.
    const component = computed(() => {
      void version.value;
      return props.surface.model.componentsModel.get(props.componentId);
    });
    const properties = computed(() => {
      void version.value;
      const wire: Record<string, unknown> | undefined =
        component.value?.properties;
      return wire;
    });
    return () => {
      const { surface, componentId, basePath, ancestors } = props;
      if (ancestors.includes(scopedId(componentId, basePath))) {
        return h(DefaultNodeFallback, {
          message: `cyclic reference to ${componentId}`,
          componentId,
        });
      }
      const model = component.value;
      const wire = properties.value;
      if (!model || !wire) return null;
      const definition = runtime.value.ui.components.get(model.type);
      if (!definition) {
        return h(DefaultNodeFallback, {
          message: `unknown component "${model.type}"`,
          componentId,
        });
      }
      return h(
        NodeBoundary,
        {
          key: model.type,
          surfaceId: surface.surfaceId,
          componentId,
          revision: wire,
        },
        {
          default: () =>
            h(ResolvedNode, {
              surface,
              componentId,
              definition,
              properties: wire,
              basePath,
              ancestors,
            }),
        },
      );
    };
  },
});

/**
 * Renders the catalog component of a node with its props, events, writable
 * props and slots, and provides the node context to it.
 */
const ResolvedNode = defineComponent({
  name: "GenerativeUIResolvedNode",
  props: {
    ...nodeProps,
    definition: {
      type: Object as PropType<ResolvedGenerativeUIComponent>,
      required: true,
    },
    /** The wire props of the node. */
    properties: {
      type: Object as PropType<Record<string, unknown>>,
      required: true,
    },
  },
  setup(props) {
    const runtime = useRequiredGenerativeUIRuntime();
    const version = useSurfaceVersion(runtime);
    const dataModel = computed(() => {
      void version.value;
      return props.surface.model.dataModel;
    });

    // Writable props. For a prop the model bound to `{"@path"}`, a write goes
    // to the data model and makes the path user-owned. For a literal prop,
    // it sets `overrides`, a local value of this mounted node.
    const overrides = shallowRef<Record<string, unknown>>({});
    const write = (key: string, value: unknown) => {
      const binding = props.properties[key];
      if (!isPathBinding(binding)) {
        overrides.value = { ...overrides.value, [key]: value };
        return;
      }
      try {
        runtime.value.manager.setOwnedValue(
          props.surface.key,
          resolvePath(binding["@path"], props.basePath),
          value,
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        reportErrorSafely(runtime.value, {
          kind: "props",
          surfaceId: props.surface.surfaceId,
          componentId: props.componentId,
          error: new Error(`${setterNameOf(key)}: ${message}`),
        });
      }
    };
    // `update:<key>` listeners, so `defineModel` and `v-model` work.
    const modelListeners = computed(() => {
      const listeners: Record<string, (value: unknown) => void> = {};
      for (const key of props.definition.writable ?? []) {
        listeners[`onUpdate:${key}`] = (value) => write(key, value);
      }
      return listeners;
    });

    // Data props, in three steps: resolve and check the model-set props,
    // run the selectors with them, then parse all props.
    const resolver = new ModelPropsResolver();
    const dataVersion = shallowRef(0);
    const resolution = stableComputed(
      () => {
        void dataVersion.value;
        const data = resolver.resolve(
          props.definition,
          props.properties,
          props.basePath,
          overrides.value,
          dataModel.value,
        );
        return { data, pathKey: resolver.pathKey };
      },
      (a, b) => a.pathKey === b.pathKey && sameModelData(a.data, b.data),
    );
    // The data model paths that the props read. The data model never replays
    // the current value on subscribe, so a write that landed between the
    // resolution and the subscription is caught by the staleness check.
    watch(
      [dataModel, () => resolution.value.pathKey],
      ([model, pathKey], _previous, onCleanup) => {
        const paths = pathKey === "" ? [] : pathKey.split("\n");
        const onChange = () => {
          resolver.invalidate();
          dataVersion.value++;
        };
        const subscriptions = paths.map((path) =>
          model.subscribe(path, onChange),
        );
        if (resolver.isStale(model)) onChange();
        onCleanup(() => {
          for (const subscription of subscriptions) subscription.unsubscribe();
        });
      },
      { immediate: true },
    );
    const modelCheck = computed(() => {
      const { data } = resolution.value;
      return data.ok ? checkModelProps(props.definition, data.values) : data;
    });
    // The app state. A manager change that is not a state change keeps it.
    const appState = computed(() => {
      void version.value;
      return runtime.value.manager.getState();
    });
    // The selectors run again only when the state or the checked model
    // props change, and the result is kept while it is shallow-equal: a
    // selector that returns a new array on each call cannot cause a loop.
    const selection = stableComputed(() => {
      const check = modelCheck.value;
      const hasSelectors = Object.keys(props.definition.selectors).length > 0;
      if (!hasSelectors || !check.ok) return NO_SELECTION;
      return selectBoundProps(props.definition, appState.value, check.values);
    }, sameChecked);
    const dataProps = computed((): DataProps => {
      const check = modelCheck.value;
      if (!check.ok) return check;
      const selected = selection.value;
      if (!selected.ok) return selected;
      const { data } = resolution.value;
      return parseDataProps(
        props.definition,
        check.values,
        selected.values,
        data.ok ? data.accessibility : undefined,
      );
    });
    const accessibility = stableComputed(
      () => (dataProps.value.ok ? dataProps.value.accessibility : undefined),
      (a, b) => shallowEqual({ ...a }, { ...b }),
    );
    const problem = computed(() =>
      dataProps.value.ok ? undefined : dataProps.value.problem,
    );
    watch(
      problem,
      (current) => {
        if (!current) return;
        reportErrorSafely(runtime.value, {
          kind: "props",
          surfaceId: props.surface.surfaceId,
          componentId: props.componentId,
          error: new Error(`Invalid props: ${current}`),
        });
      },
      { immediate: true },
    );

    // Events. A matched event (one that matches a declared function) is
    // always bound. An unmatched event is bound only when the model bound it.
    const boundEventNames = computed(() =>
      Object.keys(props.definition.events ?? {})
        .filter(
          (name) =>
            hasOwn(props.definition.eventFunctions, name) ||
            isActionBinding(props.properties[name]),
        )
        .join("|"),
    );
    const eventHandlers = computed(() => {
      const handlers: Record<
        string,
        (args?: unknown) => Promise<GenerativeUIInvokeResult>
      > = {};
      const names = boundEventNames.value;
      if (names === "") return handlers;
      const { surface, componentId, basePath, definition } = props;
      const engine = engineOf(runtime.value);
      for (const name of names.split("|")) {
        const call = {
          runtime: engine,
          surface,
          componentId,
          name,
          parameters: definition.events?.[name]?.parameters,
        };
        const functionName = hasOwn(definition.eventFunctions, name)
          ? definition.eventFunctions[name]
          : undefined;
        handlers[name] =
          functionName === undefined
            ? async (args) => {
                // The latest binding: the agent can change it without a remount.
                const binding = props.properties[name];
                if (!isActionBinding(binding)) {
                  // The agent removed the binding; the component kept the
                  // handler of the earlier revision.
                  return {
                    ok: false,
                    error: new GenerativeUIError(
                      "event_forward_failed",
                      `${name}: the event is no longer bound`,
                    ),
                  };
                }
                return invokeBoundEvent({ ...call, binding, basePath, args });
              }
            : (args) => invokeMatchedEvent({ ...call, functionName, args });
      }
      return handlers;
    });

    // Children: slots, and `child()` / `childList()` refs inside data props.
    const childAncestors = computed(() => [
      ...props.ancestors,
      scopedId(props.componentId, props.basePath),
    ]);
    const slotTemplatePaths = computed(() =>
      Object.entries(props.definition.slots ?? {})
        .map(([name, kind]) => {
          const value = props.properties[name];
          return kind === "multiple" && isTemplateChildren(value)
            ? resolvePath(value.path, props.basePath)
            : undefined;
        })
        .filter((path) => path !== undefined)
        .join("\n"),
    );
    const slotListsVersion = useDataPathsVersion(
      () => dataModel.value,
      () => slotTemplatePaths.value,
    );
    const renderChild = (id: string) =>
      h(NodeView, {
        key: id,
        surface: props.surface,
        componentId: id,
        basePath: props.basePath,
        ancestors: childAncestors.value,
      });
    /** One Vue slot per filled slot key, giving one VNode per child. */
    const renderSlots = () => {
      const slots: Record<string, () => VNode[]> = {};
      const entries = Object.entries(props.definition.slots ?? {});
      for (const [name, kind] of entries) {
        const value = props.properties[name];
        if (kind === "single" && typeof value === "string") {
          slots[name] = () => [renderChild(value)];
        } else if (kind === "multiple" && isTemplateChildren(value)) {
          slots[name] = () => {
            void slotListsVersion.value;
            return templateItems(
              props.surface,
              value,
              props.basePath,
              childAncestors.value,
            );
          };
        } else if (kind === "multiple" && Array.isArray(value)) {
          const ids = uniqueIds(value);
          slots[name] = () => ids.map(renderChild);
        }
      }
      return slots;
    };
    /** A rendered child ref: one VNode, or `undefined` when it names nothing. */
    const renderRef = (kind: ChildRef["kind"], value: unknown) => {
      if (kind === "single") {
        return typeof value === "string" ? renderChild(value) : undefined;
      }
      if (isTemplateChildren(value)) {
        return h(TemplateChildren, {
          surface: props.surface,
          template: value,
          basePath: props.basePath,
          ancestors: childAncestors.value,
        });
      }
      if (!Array.isArray(value)) return undefined;
      return h(Fragment, uniqueIds(value).map(renderChild));
    };
    /** The data props with every child ref replaced by its VNode. */
    const withChildRefs = (data: Record<string, unknown>) => {
      const refs = props.definition.childRefs;
      if (refs.length === 0) return data;
      let result: unknown = data;
      for (const ref of refs) {
        result = mapAtChildRef(result, ref.path, (found) =>
          renderRef(ref.kind, found),
        );
      }
      return isRecord(result) ? result : data;
    };

    const nodeContext = computed(
      (): GenerativeUINodeContextValue => ({
        surfaceKey: props.surface.key,
        surfaceId: props.surface.surfaceId,
        componentId: props.componentId,
        accessibility: accessibility.value,
      }),
    );
    provide(GenerativeUINodeKey, nodeContext);

    return () => {
      const data = dataProps.value;
      if (!data.ok) {
        return h(DefaultNodeFallback, {
          message: `invalid props (${data.problem})`,
          componentId: props.componentId,
        });
      }
      const { definition, properties } = props;
      const rendered = h(
        definition.component,
        {
          ...withChildRefs(data.props),
          ...eventHandlers.value,
          ...modelListeners.value,
        },
        renderSlots(),
      );
      // The hidden state and the live region of the envelope apply to every
      // component here, in a wrapper with no box of its own. A label or a
      // description needs an element with a role, so the component sets
      // those itself (see useGenerativeUIAccessibility). The wrapper is there
      // whenever the component has an envelope (unless the component
      // applies the envelope itself: a table row or cell cannot sit in a
      // span), whatever its values: a bound `hidden` that flips must not
      // remount the component and lose what the user typed into it.
      const hasEnvelope =
        properties.accessibility !== undefined &&
        definition.accessibility !== "self";
      if (!hasEnvelope) return rendered;
      return h(
        "span",
        {
          "data-a2ui-accessibility": "",
          style: ROOT_STYLE,
          ...wrapperAria(accessibilityAttributes(accessibility.value)),
        },
        [rendered],
      );
    };
  },
});

/**
 * Experimental. Renders one surface: its root component and everything
 * under it. The chat card and `GenerativeUISurface` use it.
 *
 * Each component gets its parsed data props (bound props included), its
 * bound events as function props, each writable prop as a `v-model`
 * (`update:<key>`), and its `slots` as Vue named slots with one VNode per
 * child. A component that throws, or whose props are invalid, shows a
 * fallback in its place, and the rest of the surface keeps working.
 *
 * The root element has `display: contents`, so it stays out of the layout,
 * and the `--a2ui-*` variables of the theme still reach every component.
 * The `a2ui-surface` class scopes the standard stylesheet.
 *
 * @throws Error in setup when it is rendered outside a `CopilotKitProvider`
 *   with a `generativeUI` config.
 *
 * @example
 * ```vue
 * <SurfaceView :surface="surface" />
 * ```
 */
export const SurfaceView = defineComponent({
  name: "GenerativeUISurfaceView",
  props: {
    /** The surface of the manager to render. */
    surface: nodeProps.surface,
  },
  setup(props) {
    const runtime = useRequiredGenerativeUIRuntime();
    const version = useManagerVersion(runtime);
    provide(SurfaceVersionKey, version);
    // A failed surface tries again with new content, as a failed node does
    // with new props. New content is a new operation applied, or a rebuilt
    // surface (a new object). The manager also notifies for ingests that
    // bring nothing new and for other surfaces; those keep the revision.
    const revision = shallowRef(0);
    watch(
      [
        () => props.surface,
        () => {
          void version.value;
          return props.surface.operations.length;
        },
      ],
      () => {
        revision.value += 1;
      },
    );
    // The theme is a stylesheet, not an inline style, so that its `dark`
    // values can apply in dark mode only. The values are checked in
    // `themeStyleSheet`, and the CSS is set as is, so the server render
    // keeps the quotes of the rule.
    const sheet = useThemeStyleSheet(() => runtime.value.theme);
    return () => {
      const { surfaceId } = props.surface;
      const theme = sheet.value;
      return h(
        "div",
        {
          class: "a2ui-surface",
          "data-generative-ui-root": surfaceId,
          "data-a2ui-theme": theme?.id,
          style: ROOT_STYLE,
        },
        [
          theme ? h("style", { innerHTML: theme.css }) : null,
          h(
            SurfaceBoundary,
            { surfaceId, revision: revision.value },
            {
              default: () =>
                h(NodeView, {
                  surface: props.surface,
                  componentId: GENERATIVE_UI_ROOT_ID,
                  basePath: undefined,
                  ancestors: NO_ANCESTORS,
                }),
            },
          ),
        ],
      );
    };
  },
});
