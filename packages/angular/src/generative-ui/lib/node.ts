import {
  Component,
  DOCUMENT,
  EnvironmentInjector,
  Injector,
  RendererFactory2,
  computed,
  createComponent,
  effect,
  input,
  inputBinding,
  outputBinding,
  reflectComponentType,
  signal,
  untracked,
} from "@angular/core";
import type {
  Binding,
  ComponentRef,
  EffectRef,
  Renderer2,
  Signal,
  Type,
  ViewContainerRef,
  ViewRef,
} from "@angular/core";
import {
  isActionBinding,
  isPathBinding,
  mapAtChildRef,
} from "@copilotkit/shared";
import type { GenerativeUIActionBinding } from "@copilotkit/shared";
import {
  accessibilityAttributes,
  invokeBoundEvent,
  invokeMatchedEvent,
  reportErrorSafely,
  resolvePath,
  wrapperAria,
} from "@copilotkit/core/generative-ui";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import type { ResolvedGenerativeUIComponent } from "./catalog";
import { childrenHandle } from "./children";
import type { GenerativeUIChildren } from "./children";
import { GENERATIVE_UI_NODE_CONTEXT } from "./node-context";
import type { GenerativeUINodeContext } from "./node-context";
import {
  ModelPropsResolver,
  NO_SELECTION,
  checkModelProps,
  parseDataProps,
  sameModelData,
  sameSelection,
  selectBoundProps,
} from "./node-props";
import type { DataProps, ModelCheck, ModelData, Selection } from "./node-props";
import type { GenerativeUIRuntime } from "./runtime";

/** Where a node renders: which component of which surface, and in which template item. */
interface GenerativeUINodeInput {
  surface: ManagedSurface;
  componentId: string;
  /**
   * The data model path of the template item this node renders, or
   * `undefined` outside of a template. Relative paths resolve against it.
   */
  basePath: string | undefined;
  /** Scoped ids of the nodes above this one; used to cut cyclic references. */
  ancestors: readonly string[];
}

/**
 * The id of a node in the ancestor list. A template renders the same
 * component once per item, so the item path is part of the id. A real cycle
 * repeats both.
 */
function scopedId(componentId: string, basePath: string | undefined) {
  return `${basePath ?? ""}#${componentId}`;
}

/**
 * The default fallback of a component that cannot render. `retry` is set
 * after a render error, and renders the component again.
 */
@Component({
  selector: "copilot-generative-ui-node-fallback",
  template: `
    Couldn’t display this part: {{ message() }}
    @if (retry(); as again) {
      <button
        type="button"
        (click)="again()"
        style="margin-left: 8px; text-decoration: underline"
      >
        Retry
      </button>
    }
  `,
  host: {
    role: "alert",
    "[attr.data-generative-ui-error]": "componentId()",
    style:
      "display:block;border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:8px;padding:8px 12px;font-size:13px",
  },
})
export class CopilotGenerativeUINodeFallback {
  readonly message = input.required<string>();
  readonly componentId = input.required<string>();
  readonly retry = input<() => void>();
}

/**
 * A component whose host element depends on the node, such as `h2` or `h3`,
 * `th` or `td`. The renderer creates that element as the host instead of the
 * selector's tag, and creates the component again when the tag changes.
 */
interface GenerativeUIHostTag {
  hostTag(props: Record<string, unknown>, injector: Injector): string;
}

function hostTagOf(
  type: Type<unknown>,
  props: Record<string, unknown>,
  injector: Injector,
) {
  return (type as Partial<GenerativeUIHostTag>).hostTag?.(props, injector);
}

type Outcome =
  | { kind: "empty" }
  | { kind: "fallback"; message: string; problem?: string }
  | {
      kind: "component";
      type: Type<unknown>;
      definition: ResolvedGenerativeUIComponent;
      tag: string | undefined;
    };

function sameOutcome(a: Outcome, b: Outcome) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "fallback" && b.kind === "fallback") {
    return a.message === b.message && a.problem === b.problem;
  }
  if (a.kind === "component" && b.kind === "component") {
    return (
      a.type === b.type && a.definition === b.definition && a.tag === b.tag
    );
  }
  return true;
}

function sameHandle(
  a: GenerativeUIChildren | undefined,
  b: GenerativeUIChildren | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.value === b.value && a.basePath === b.basePath;
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Renders one component of a surface into a view container, and keeps it
 * current: the props it gets, the events it can send, the slots it renders
 * and the two-way bindings of its writable props.
 *
 * The component is created once and recreated only when its type changes.
 * Its inputs are bound with getters, so they update in place. A component
 * that cannot render, or whose props are invalid, shows the fallback.
 */
export class GenerativeUINodeRenderer {
  readonly #resolver = new ModelPropsResolver();
  readonly #overrides = signal<Record<string, unknown>>({});
  readonly #dataVersion = signal(0);
  readonly #effects: EffectRef[] = [];
  readonly #slotHandles = new Map<
    string,
    Signal<GenerativeUIChildren | undefined>
  >();
  readonly #ref = signal<ComponentRef<unknown> | undefined>(undefined);
  readonly #renderer: Renderer2;
  #rendered: Outcome = { kind: "empty" };
  #reportedProblem: string | undefined;
  #lastInputs: Record<string, unknown> = {};
  /** The envelope attributes this node set on the host element. */
  #setAttributes = new Set<string>();

  /** The component model of this node. Follows the manager. */
  readonly component = computed(() => {
    this.runtime.version();
    return this.node.surface.model.componentsModel.get(this.node.componentId);
  });

  /** The wire props of the node; a new object is a new agent revision. */
  readonly properties = computed(() => {
    this.runtime.version();
    return this.component()?.properties as Record<string, unknown> | undefined;
  });

  readonly definition = computed(() => {
    const component = this.component();
    return component
      ? this.runtime.ui.components.get(component.type)
      : undefined;
  });

  readonly #resolution = computed<{
    data: ModelData | undefined;
    pathKey: string;
  }>(
    () => {
      this.#dataVersion();
      const definition = this.definition();
      const properties = this.properties();
      if (!definition || !properties) return { data: undefined, pathKey: "" };
      const data = this.#resolver.resolve(
        definition,
        properties,
        this.node.basePath,
        this.#overrides(),
        this.node.surface.model.dataModel,
      );
      return { data, pathKey: this.#resolver.pathKey };
    },
    {
      equal: (a, b) =>
        a.pathKey === b.pathKey &&
        (a.data === b.data ||
          (a.data !== undefined &&
            b.data !== undefined &&
            sameModelData(a.data, b.data))),
    },
  );

  readonly #modelCheck = computed<ModelCheck | undefined>(() => {
    const { data } = this.#resolution();
    const definition = this.definition();
    if (!data || !definition) return undefined;
    return data.ok ? checkModelProps(definition, data.values) : data;
  });

  /** The app state. A manager notification that is not a state change keeps it. */
  readonly #state = computed(() => {
    this.runtime.version();
    return this.runtime.manager.getState();
  });

  /**
   * The bound props, from the app state. The selectors run again only when
   * the state object or the checked model props change, and the result keeps
   * its identity while shallow-equal: a selector that returns a new array on
   * each call cannot cause an update loop.
   */
  readonly #selection = computed<Selection>(
    () => {
      const definition = this.definition();
      const check = this.#modelCheck();
      if (!definition || !check?.ok) return NO_SELECTION;
      if (Object.keys(definition.selectors).length === 0) return NO_SELECTION;
      return selectBoundProps(definition, this.#state(), check.values);
    },
    { equal: sameSelection },
  );

  /** The parsed data props, or the reason they could not be computed. */
  readonly dataProps = computed<DataProps | undefined>(() => {
    const definition = this.definition();
    const check = this.#modelCheck();
    const { data } = this.#resolution();
    if (!definition || !check || !data) return undefined;
    if (!check.ok) return check;
    const selection = this.#selection();
    if (!selection.ok) return selection;
    return parseDataProps(
      definition,
      check.values,
      selection.values,
      data.ok ? data.accessibility : undefined,
    );
  });

  /** The resolved `accessibility` of the component envelope. */
  readonly accessibility = computed(() => {
    const data = this.dataProps();
    return data?.ok ? data.accessibility : undefined;
  });

  /** The data props with each `child()`/`childList()` value replaced by a handle. */
  readonly #inputs = computed<Record<string, unknown> | undefined>(() => {
    const data = this.dataProps();
    if (!data?.ok) return undefined;
    const refs = this.definition()?.childRefs ?? [];
    if (refs.length === 0) return data.props;
    let result: unknown = data.props;
    for (const ref of refs) {
      result = mapAtChildRef(result, ref.path, (found) => this.#handle(found));
    }
    return result as Record<string, unknown>;
  });

  /**
   * The names of the events that have a handler: a matched event always,
   * an unmatched one only when the model bound it.
   */
  readonly #boundEventNames = computed(() => {
    const definition = this.definition();
    const properties = this.properties();
    if (!definition || !properties) return "";
    return Object.keys(definition.events ?? {})
      .filter(
        (name) =>
          hasOwn(definition.eventFunctions, name) ||
          isActionBinding(properties[name]),
      )
      .join("|");
  });

  readonly #eventHandlers = computed(() => {
    const names = this.#boundEventNames();
    const definition = this.definition();
    const handlers: Record<
      string,
      (args?: unknown) => Promise<GenerativeUIInvokeResult>
    > = {};
    if (!definition || names === "") return handlers;
    const { surface, componentId, basePath } = this.node;
    for (const name of names.split("|")) {
      const call = {
        runtime: this.runtime,
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
          ? (args) =>
              invokeBoundEvent({
                ...call,
                // The latest binding: the agent can change it without a remount.
                binding: untracked(this.properties)?.[
                  name
                ] as GenerativeUIActionBinding,
                basePath,
                args,
              })
          : (args) => invokeMatchedEvent({ ...call, functionName, args });
    }
    return handlers;
  });

  readonly #outcome = computed<Outcome>(
    () => {
      const { componentId, basePath, ancestors } = this.node;
      if (ancestors.includes(scopedId(componentId, basePath))) {
        return {
          kind: "fallback",
          message: `cyclic reference to ${componentId}`,
        };
      }
      const component = this.component();
      const properties = this.properties();
      // A child that has not streamed yet renders nothing: each component
      // appears as soon as it is complete.
      if (!component || !properties) return { kind: "empty" };
      const definition = this.definition();
      if (!definition) {
        return {
          kind: "fallback",
          message: `unknown component "${component.type}"`,
        };
      }
      const data = this.dataProps();
      if (data && !data.ok) {
        return {
          kind: "fallback",
          message: `invalid props (${data.problem})`,
          problem: data.problem,
        };
      }
      return {
        kind: "component",
        type: definition.component,
        definition,
        // The props the component gets: a bound path resolved, and an event
        // the app matched to a function present without a model binding.
        tag: hostTagOf(
          definition.component,
          { ...this.#inputs(), ...this.#eventHandlers() },
          this.injector,
        ),
      };
    },
    { equal: sameOutcome },
  );

  constructor(
    private readonly host: ViewContainerRef,
    private readonly runtime: GenerativeUIRuntime,
    private readonly injector: Injector,
    readonly node: GenerativeUINodeInput,
    /** Where a new view of this node goes in the container. */
    private readonly locate: () => number,
  ) {
    this.#renderer = injector.get(RendererFactory2).createRenderer(null, null);
    const options = { injector };
    this.#effects.push(
      effect(() => {
        const outcome = this.#outcome();
        // A new agent revision renders a component that failed again; a
        // data tick does not.
        this.properties();
        untracked(() => this.#apply(outcome));
      }, options),
      // The data model paths that the props read. web_core never replays the
      // current value on subscribe, so a write that landed between the
      // resolution and the subscription is caught by the staleness check.
      effect((onCleanup) => {
        const { pathKey } = this.#resolution();
        const paths = pathKey === "" ? [] : pathKey.split("\n");
        const dataModel = this.node.surface.model.dataModel;
        const onChange = () => {
          this.#resolver.invalidate();
          this.#dataVersion.update((n) => n + 1);
        };
        const subscriptions = paths.map((path) =>
          dataModel.subscribe(path, onChange),
        );
        if (untracked(() => this.#resolver.isStale(dataModel))) onChange();
        onCleanup(() => subscriptions.forEach((s) => s.unsubscribe()));
      }, options),
      // The hidden state and the live region of the envelope apply on the
      // host element of the component, which has no box of its own in the
      // standard catalog. A label or a description needs an element with a
      // role, so the component sets those itself. A component that applies
      // the envelope itself (a table row or cell) gets nothing here. Only
      // the attributes this effect set are removed again: a component may
      // set `aria-hidden` on its own host.
      effect(() => {
        const ref = this.#ref();
        const properties = this.properties();
        const definition = this.definition();
        const aria = wrapperAria(accessibilityAttributes(this.accessibility()));
        untracked(() => {
          if (!ref || this.#rendered.kind !== "component") return;
          const element = ref.location.nativeElement;
          const hasEnvelope =
            properties?.accessibility !== undefined &&
            definition?.accessibility !== "self";
          const next = new Map<string, string>();
          if (hasEnvelope) {
            next.set("data-a2ui-accessibility", "");
            if (aria["aria-hidden"]) next.set("aria-hidden", "true");
            if (aria["aria-live"]) next.set("aria-live", aria["aria-live"]);
          }
          for (const name of this.#setAttributes) {
            if (!next.has(name)) this.#renderer.removeAttribute(element, name);
          }
          for (const [name, value] of next) {
            this.#renderer.setAttribute(element, name, value);
          }
          this.#setAttributes = new Set(next.keys());
        });
      }, options),
    );
  }

  /** The view this node has in the container, if any. */
  get view(): ViewRef | undefined {
    return untracked(this.#ref)?.hostView;
  }

  destroy() {
    for (const ref of this.#effects) ref.destroy();
    this.#effects.length = 0;
    const ref = untracked(this.#ref);
    this.#ref.set(undefined);
    ref?.destroy();
  }

  #handle(value: unknown) {
    const { surface, componentId, basePath, ancestors } = this.node;
    return childrenHandle(
      surface,
      basePath,
      [...ancestors, scopedId(componentId, basePath)],
      value,
    );
  }

  #slotHandle(name: string) {
    let handle = this.#slotHandles.get(name);
    if (!handle) {
      handle = computed(() => this.#handle(this.properties()?.[name]), {
        equal: sameHandle,
      });
      this.#slotHandles.set(name, handle);
    }
    return handle;
  }

  /** The value of a data input. The last valid props while the node shows the fallback. */
  #inputValue(key: string) {
    const inputs = this.#inputs();
    if (inputs !== undefined) this.#lastInputs = inputs;
    return (inputs ?? this.#lastInputs)[key];
  }

  /**
   * Writes a writable prop. For a prop the model bound to `{"@path"}`, it
   * writes the data model and makes the path user-owned. For a literal prop,
   * it sets a local value of this node.
   */
  #applySetter(key: string, value: unknown) {
    const binding = untracked(this.properties)?.[key];
    if (!isPathBinding(binding)) {
      this.#overrides.update((current) => ({ ...current, [key]: value }));
      return;
    }
    const { surface, componentId, basePath } = this.node;
    try {
      this.runtime.manager.setOwnedValue(
        surface.key,
        resolvePath(binding["@path"], basePath),
        value,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      reportErrorSafely(this.runtime, {
        kind: "props",
        surfaceId: surface.surfaceId,
        componentId,
        error: new Error(`${key}Change: ${message}`),
      });
    }
  }

  /**
   * The bindings of the component: one per input it declares among the
   * props, events and slots of the definition, and the `<key>Write` (else
   * `<key>Change`) output of each writable prop. A binding to an input the component does not
   * declare would throw, so the component's own inputs decide.
   */
  #bindings(type: Type<unknown>, definition: ResolvedGenerativeUIComponent) {
    const mirror = reflectComponentType(type);
    if (!mirror) {
      throw new Error(`"${type.name}" is not an Angular component`);
    }
    const inputs = new Set(mirror.inputs.map((entry) => entry.templateName));
    const outputs = new Set(mirror.outputs.map((entry) => entry.templateName));
    const bindings: Binding[] = [];
    for (const key of definition.propKeys) {
      if (inputs.has(key)) {
        bindings.push(inputBinding(key, () => this.#inputValue(key)));
      }
    }
    for (const key of definition.writable ?? []) {
      // A standard control emits `<key>Write` on every write of the user,
      // also one that leaves the value equal, which a `model()` never emits.
      const name = outputs.has(`${key}Write`) ? `${key}Write` : `${key}Change`;
      if (outputs.has(name)) {
        bindings.push(
          outputBinding(name, (value: unknown) =>
            this.#applySetter(key, value),
          ),
        );
      }
    }
    for (const name of Object.keys(definition.events ?? {})) {
      if (inputs.has(name)) {
        bindings.push(inputBinding(name, () => this.#eventHandlers()[name]));
      }
    }
    for (const name of Object.keys(definition.slots ?? {})) {
      if (inputs.has(name)) {
        const handle = this.#slotHandle(name);
        bindings.push(inputBinding(name, () => handle()));
      }
    }
    return bindings;
  }

  #apply(outcome: Outcome) {
    const { surface, componentId } = this.node;
    if (
      outcome.kind === "fallback" &&
      outcome.problem !== undefined &&
      outcome.problem !== this.#reportedProblem
    ) {
      this.#reportedProblem = outcome.problem;
      reportErrorSafely(this.runtime, {
        kind: "props",
        surfaceId: surface.surfaceId,
        componentId,
        error: new Error(`Invalid props: ${outcome.problem}`),
      });
    }
    if (sameOutcome(outcome, this.#rendered)) return;
    this.#rendered = outcome;
    if (outcome.kind === "empty") {
      this.#replace(undefined);
      return;
    }
    if (outcome.kind === "fallback") {
      this.#replace(this.#createFallback(outcome.message));
      return;
    }
    const { type, definition, tag } = outcome;
    const context: GenerativeUINodeContext = {
      surfaceKey: surface.key,
      surfaceId: surface.surfaceId,
      componentId,
      accessibility: this.accessibility,
    };
    const injector = Injector.create({
      providers: [{ provide: GENERATIVE_UI_NODE_CONTEXT, useValue: context }],
      parent: this.injector,
    });
    try {
      this.#replace(
        this.#create(type, this.#bindings(type, definition), injector, tag),
      );
    } catch (cause) {
      // There is no error boundary in Angular. A component that throws while
      // it is created shows the fallback; an error in a later change
      // detection goes to the ErrorHandler of the app.
      const error = cause instanceof Error ? cause : new Error(String(cause));
      reportErrorSafely(this.runtime, {
        kind: "render",
        surfaceId: surface.surfaceId,
        componentId,
        error,
      });
      this.#rendered = { kind: "fallback", message: error.message };
      this.#replace(this.#createFallback(error.message, this.#retry));
    }
  }

  /** Renders the component again after a render error, with the current data. */
  readonly #retry = () => {
    if (this.#rendered.kind !== "fallback") return;
    this.#rendered = { kind: "empty" };
    this.#apply(untracked(this.#outcome));
  };

  #createFallback(message: string, retry?: () => void) {
    const { componentId } = this.node;
    const type = this.runtime.errorFallback ?? CopilotGenerativeUINodeFallback;
    const bindings = [
      inputBinding("message", () => message),
      inputBinding("componentId", () => componentId),
    ];
    // Only a fallback that declares `retry` gets it: a binding to an input
    // the component does not have would throw.
    const hasRetry = reflectComponentType(type)?.inputs.some(
      (entry) => entry.templateName === "retry",
    );
    if (retry && hasRetry) bindings.push(inputBinding("retry", () => retry));
    return this.#create(type, bindings, this.injector);
  }

  /**
   * Creates a view at the place of the current one, or where `locate` says.
   * With a `tag`, the host is that element instead of the one of the
   * selector (see {@link GenerativeUIHostTag}).
   */
  #create(
    type: Type<unknown>,
    bindings: Binding[],
    injector: Injector,
    tag?: string,
  ) {
    const current = untracked(this.#ref);
    const index = current ? this.host.indexOf(current.hostView) : this.locate();
    if (tag === undefined) {
      return this.host.createComponent(type, { index, injector, bindings });
    }
    const ref = createComponent(type, {
      environmentInjector: injector.get(EnvironmentInjector),
      elementInjector: injector,
      hostElement: injector.get(DOCUMENT).createElement(tag),
      bindings,
    });
    this.host.insert(ref.hostView, index);
    return ref;
  }

  #replace(next: ComponentRef<unknown> | undefined) {
    this.#setAttributes = new Set();
    const previous = untracked(this.#ref);
    this.#ref.set(next);
    previous?.destroy();
  }
}
