import type { AgentSubscriber } from "@ag-ui/client";
import {
  createParserState,
  createResolutionCache,
  finalizeJsonParse,
  getStreamStatus,
  getResolvedValue,
  isStreamingSchema,
  parseChunk,
  resolveStreamingValue,
  validateFinalValue,
} from "@copilotkit/schema";
import type {
  ParserState,
  ResolutionCache,
  StreamReadiness,
} from "@copilotkit/schema";
import { Section } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  InteractionContext,
  MessageRef,
  Renderable,
} from "@copilotkit/channels-ui";
import type {
  ChannelComponentActionRuntime,
  ActionRegistry,
} from "./action-registry.js";
import { createChannelComponentCallbackBinders } from "./channel-component.js";
import type {
  ChannelComponentDefinition,
  ChannelComponentPlatform,
} from "./channel-component.js";
import { createComponentRevisionQueue } from "./component-revision-queue.js";
import type {
  ChannelComponentErrorSnapshot,
  ChannelComponentInstanceSnapshot,
  ChannelComponentStore,
} from "./component-store.js";
import { freezeComponentProps, snapshotComponentState } from "./json-value.js";
import type { JsonValue } from "./json-value.js";
import type {
  CapturedToolCall,
  ChannelComponentDeliveryPolicy,
} from "./platform-adapter.js";
import { validateSchema } from "./standard-schema.js";

const COMPONENT_RENDERED_RESULT = (name: string) =>
  `Rendered component "${name}" in the current thread.`;

/** Strict provider delivery used by one component run. */
export interface ChannelComponentDelivery {
  platform: ChannelComponentPlatform;
  /** Provider-owned cadence and retry limits. */
  policy?: ChannelComponentDeliveryPolicy;
  /** Whether partial revisions may be posted before the ready render. */
  progressive?: boolean;
  post(ir: ChannelNode[]): Promise<MessageRef>;
  update(ref: MessageRef, ir: ChannelNode[]): Promise<void>;
}

interface CoordinatorOptions {
  components: readonly ChannelComponentDefinition[];
  store: ChannelComponentStore;
  registry: ActionRegistry;
  /** Internal deterministic cadence seam. Production uses Slack/Teams defaults. */
  minIntervalMs?: (platform: ChannelComponentPlatform) => number;
  /** Internal deterministic retry timer seam. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Internal deterministic retry backoff seam. */
  retryDelayMs?: (attempt: number) => number;
  /** Internal deterministic interaction retry seam. */
  maxAttempts?: number;
}

/** Per-agent-run component event consumer and tool executor. */
export interface ChannelComponentRun {
  readonly subscriber: AgentSubscriber;
  hasComponent(name: string): boolean;
  instanceId(toolCallId: string, runId?: string): string;
  executionKey(call: CapturedToolCall): string;
  start(toolCallId: string, componentName: string, runId?: string): void;
  acceptDelta(toolCallId: string, delta: string, runId?: string): void;
  finish(call: CapturedToolCall): Promise<string>;
  failAll(error: unknown): Promise<void>;
}

/** Channel-wide owner of definitions, durable callbacks, and live controllers. */
export interface ChannelComponentCoordinator extends ChannelComponentActionRuntime {
  createRun(delivery: ChannelComponentDelivery): ChannelComponentRun;
  hasComponent(name: string): boolean;
}

/** Create the functional runtime coordinator for registered V2 components. */
export function createChannelComponentCoordinator(
  options: CoordinatorOptions,
): ChannelComponentCoordinator {
  const definitions = new Map(
    options.components.map((component) => [component.name, component]),
  );
  const live = new Map<string, ComponentController>();
  const coldStateTails = new Map<string, Promise<void>>();

  const coordinator: ChannelComponentCoordinator = {
    hasComponent: (name) => definitions.has(name),
    isLive: (id) => live.has(id),
    createRun(delivery) {
      const fallbackRunId = globalThis.crypto.randomUUID();
      const controllers = new Map<string, ComponentController>();
      const names = new Map<string, string>();
      const latestKeys = new Map<string, string>();
      const endedKeys = new Map<string, string[]>();
      const eventCompleteKeys = new Set<string>();
      const callKeys = new WeakMap<CapturedToolCall, string>();
      const assignedCapturedKeys = new Set<string>();
      let runFailure: unknown;

      const keyFor = (toolCallId: string, eventRunId?: string): string =>
        `${eventRunId ?? fallbackRunId}:${toolCallId}`;

      const ensure = (
        toolCallId: string,
        componentName: string,
        eventRunId?: string,
      ): ComponentController => {
        const key = keyFor(toolCallId, eventRunId);
        const current = controllers.get(key);
        if (current) return current;
        const definition = definitions.get(componentName);
        if (!definition) {
          throw new Error(`Unknown Channel component "${componentName}".`);
        }
        const controller = new ComponentController({
          id: key,
          definition,
          delivery,
          store: options.store,
          registry: options.registry,
          minIntervalMs:
            options.minIntervalMs?.(delivery.platform) ??
            delivery.policy?.minIntervalMs ??
            0,
          maxAttempts: delivery.policy?.maxAttempts,
          retryDelayMs: delivery.policy?.retryDelayMs,
          sleep: options.sleep,
        });
        controllers.set(key, controller);
        names.set(key, componentName);
        latestKeys.set(toolCallId, key);
        live.set(key, controller);
        return controller;
      };

      const keyForCapturedCall = (call: CapturedToolCall): string => {
        const assigned = callKeys.get(call);
        if (assigned) return assigned;
        if (call.runId) {
          const key = keyFor(call.toolCallId, call.runId);
          callKeys.set(call, key);
          return key;
        }
        const candidates = endedKeys.get(call.toolCallId);
        const key =
          candidates?.find(
            (candidate) => !assignedCapturedKeys.has(candidate),
          ) ??
          candidates?.at(-1) ??
          latestKeys.get(call.toolCallId) ??
          keyFor(call.toolCallId);
        callKeys.set(call, key);
        assignedCapturedKeys.add(key);
        return key;
      };

      const run: ChannelComponentRun = {
        hasComponent: (name) => definitions.has(name),
        instanceId: (toolCallId, eventRunId) =>
          eventRunId
            ? keyFor(toolCallId, eventRunId)
            : (latestKeys.get(toolCallId) ?? keyFor(toolCallId)),
        executionKey: keyForCapturedCall,
        start(toolCallId, componentName, eventRunId) {
          if (eventCompleteKeys.has(keyFor(toolCallId, eventRunId))) return;
          if (definitions.has(componentName))
            ensure(toolCallId, componentName, eventRunId);
        },
        acceptDelta(toolCallId, delta, eventRunId) {
          const key = eventRunId
            ? keyFor(toolCallId, eventRunId)
            : (latestKeys.get(toolCallId) ?? keyFor(toolCallId));
          if (eventCompleteKeys.has(key)) return;
          const name = names.get(key);
          if (name) controllers.get(key)?.acceptDelta(delta);
        },
        async finish(call) {
          const key = keyForCapturedCall(call);
          const controller =
            controllers.get(key) ??
            ensure(call.toolCallId, call.toolCallName, call.runId);
          try {
            if (runFailure) throw asError(runFailure);
            await controller.finish(call.toolCallArgs);
            return COMPONENT_RENDERED_RESULT(call.toolCallName);
          } finally {
            live.delete(controller.id);
          }
        },
        async failAll(error) {
          runFailure ??= error;
          await Promise.allSettled(
            [...controllers.values()].map(async (controller) => {
              await controller.fail(error);
              live.delete(controller.id);
            }),
          );
        },
        subscriber: {},
      };
      run.subscriber.onToolCallStartEvent = (params) => {
        run.start(
          params.event.toolCallId,
          params.event.toolCallName,
          typeof params.event.runId === "string"
            ? params.event.runId
            : undefined,
        );
      };
      run.subscriber.onToolCallArgsEvent = (params) => {
        if (params.toolCallName) {
          run.start(
            params.event.toolCallId,
            params.toolCallName,
            typeof params.event.runId === "string"
              ? params.event.runId
              : undefined,
          );
        }
        run.acceptDelta(
          params.event.toolCallId,
          params.event.delta,
          typeof params.event.runId === "string"
            ? params.event.runId
            : undefined,
        );
      };
      run.subscriber.onToolCallEndEvent = (params) => {
        const eventRunId =
          typeof params.event.runId === "string"
            ? params.event.runId
            : undefined;
        if (params.toolCallName) {
          run.start(params.event.toolCallId, params.toolCallName, eventRunId);
        }
        const key = eventRunId
          ? keyFor(params.event.toolCallId, eventRunId)
          : (latestKeys.get(params.event.toolCallId) ??
            keyFor(params.event.toolCallId));
        const keys = endedKeys.get(params.event.toolCallId) ?? [];
        if (!keys.includes(key)) {
          keys.push(key);
          endedKeys.set(params.event.toolCallId, keys);
        }
        eventCompleteKeys.add(key);
      };
      run.subscriber.onRunErrorEvent = async (params) => {
        await run.failAll(params.event);
      };
      return run;
    },
    async setState(componentInstanceId, next, context) {
      const controller = live.get(componentInstanceId);
      if (controller) {
        await controller.setState(next, context.message.ref);
        return;
      }
      const previous =
        coldStateTails.get(componentInstanceId) ?? Promise.resolve();
      const update = previous.then(() =>
        updateColdReadyState(
          componentInstanceId,
          next,
          context,
          definitions,
          options.store,
          options.registry,
          options,
        ),
      );
      coldStateTails.set(
        componentInstanceId,
        update.then(
          () => undefined,
          () => undefined,
        ),
      );
      await update;
    },
    async onInterrupted(componentInstanceId, snapshot, context) {
      const definition = definitions.get(snapshot.componentName);
      if (!definition) return;
      await replaceFailedInteraction(
        componentInstanceId,
        definition,
        snapshot,
        context,
        options.registry,
        options,
      );
    },
    async onCallbackError(error, context) {
      console.error("[channel-component] callback failed", {
        error,
        platform: context.platform,
      });
      await context.thread.post(
        Section({
          children: "This component action failed. Please try again.",
        }),
      );
    },
  };
  return coordinator;
}

interface ControllerOptions {
  id: string;
  definition: ChannelComponentDefinition;
  delivery: ChannelComponentDelivery;
  store: ChannelComponentStore;
  registry: ActionRegistry;
  minIntervalMs: number;
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface RenderRevision {
  snapshot: ChannelComponentInstanceSnapshot;
  ui: Renderable;
}

interface PreparedRevision {
  snapshot: ChannelComponentInstanceSnapshot;
  ir: ChannelNode[];
}

class ComponentController {
  readonly id: string;
  private readonly definition: ChannelComponentDefinition;
  private readonly delivery: ChannelComponentDelivery;
  private readonly store: ChannelComponentStore;
  private readonly registry: ActionRegistry;
  private readonly stateful: boolean;
  private readonly queue;
  private parser: ParserState;
  private resolutionCache: ResolutionCache;
  private state: JsonValue | undefined;
  private latestProps: JsonValue | undefined;
  private latestReadiness: StreamReadiness<unknown> = { statuses: {} };
  private revision = 0;
  private messageRef: MessageRef | undefined;
  private pending: Promise<unknown>[] = [];
  private streamError: unknown;
  private terminal = false;
  private stateTail: Promise<void> = Promise.resolve();
  private failurePromise: Promise<void> | undefined;

  constructor(options: ControllerOptions) {
    this.id = options.id;
    this.definition = options.definition;
    this.delivery = options.delivery;
    this.store = options.store;
    this.registry = options.registry;
    this.stateful = typeof options.definition.getInitialState === "function";
    this.parser = createParserState();
    this.resolutionCache = createResolutionCache();
    if (this.stateful) {
      try {
        this.state = snapshotComponentState(
          options.definition.getInitialState!(),
        );
      } catch (error) {
        this.streamError = error;
      }
    }
    this.queue = createComponentRevisionQueue<RenderRevision, PreparedRevision>(
      {
        minIntervalMs: options.minIntervalMs,
        maxAttempts: options.maxAttempts,
        retryDelayMs: options.retryDelayMs,
        sleep: options.sleep,
        prepare: async ({ value }) => {
          await this.store.putInstance(this.id, value.snapshot);
          const ir = await this.registry.bindComponentRenderable(value.ui, {
            componentInstanceId: this.id,
            phase:
              value.snapshot.phase === "failed"
                ? "ready"
                : value.snapshot.phase,
            props: value.snapshot.props,
            state: value.snapshot.state,
            revision: value.snapshot.revision,
          });
          return { snapshot: value.snapshot, ir };
        },
        deliver: async (prepared) => {
          if (!this.messageRef) {
            this.messageRef = await this.delivery.post(prepared.ir);
          } else {
            await this.delivery.update(this.messageRef, prepared.ir);
          }
        },
      },
    );
  }

  acceptDelta(delta: string): void {
    if (this.terminal) return;
    const operation = parseChunk(this.parser, delta);
    this.parser = operation.state;
    if (operation.error) {
      this.streamError = operation.error;
      return;
    }
    if (
      this.delivery.progressive === false ||
      !isStreamingSchema(this.definition.parameters as never)
    ) {
      return;
    }
    const resolved = resolveStreamingValue(
      this.definition.parameters as never,
      operation,
      this.resolutionCache,
    );
    this.resolutionCache = resolved.cache;
    if (resolved.status === "invalid") {
      this.streamError = resolved.error;
      return;
    }
    if (resolved.status !== "match" || !resolved.changed) return;
    try {
      const props = freezeComponentProps(resolved.value);
      this.latestProps = props;
      this.latestReadiness = resolved.readiness;
      this.offer(
        "streaming",
        props,
        this.renderStreaming(props, resolved.readiness),
        false,
      );
    } catch (error) {
      this.streamError = error;
    }
  }

  async finish(finalArgs: Record<string, unknown>): Promise<void> {
    if (this.terminal) return;
    try {
      if (this.streamError) throw this.streamError;
      let finalProps: unknown;
      if (this.parser.rawText.length === 0) {
        this.parser = parseChunk(this.parser, JSON.stringify(finalArgs)).state;
      }
      const finalized = finalizeJsonParse(this.parser);
      this.parser = finalized.state;
      if (finalized.error) throw finalized.error;
      if (isStreamingSchema(this.definition.parameters as never)) {
        const validation = await validateFinalValue(
          this.definition.parameters as never,
          finalized,
        );
        if (!validation.success) {
          throw new Error(formatIssues(validation.issues));
        }
        finalProps = validation.value;
      } else {
        const raw = getResolvedValue(finalized.state);
        const validation = await validateSchema(
          this.definition.parameters,
          raw,
        );
        if (!validation.ok) throw new Error(validation.error);
        finalProps = validation.value;
      }
      const props = freezeComponentProps(finalProps);
      this.latestProps = props;
      const terminal = this.enqueue(
        "ready",
        props,
        this.renderReady(props),
        true,
      );
      const results = await Promise.allSettled([...this.pending, terminal]);
      await this.queue.drain();
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed) throw failed.reason;
      if (this.streamError) throw this.streamError;
      this.terminal = true;
    } catch (error) {
      await this.fail(error);
      throw asError(error);
    }
  }

  async fail(error: unknown): Promise<void> {
    if (this.terminal) return;
    if (this.failurePromise) return this.failurePromise;
    this.failurePromise = this.deliverFailure(error);
    return this.failurePromise;
  }

  private async deliverFailure(error: unknown): Promise<void> {
    const snapshotError = componentError(error);
    const props = this.latestProps ?? {};
    const snapshot = this.snapshot("failed", props, snapshotError);
    const ui = renderFailed(this.definition, snapshot, this.delivery.platform);
    const terminal = this.queue.enqueue({
      revision: snapshot.revision,
      value: { snapshot, ui },
      terminal: true,
    });
    this.pending.push(terminal);
    try {
      await terminal;
      await this.queue.drain();
    } catch {
      // The developer's failed render can itself be invalid for the provider.
      // The failed snapshot is already durable; make one last delivery attempt
      // with the SDK-owned plain view that has no provider-native elements.
      const safe = Section({
        children: "This component could not be displayed.",
      });
      const ir = await this.registry.bindComponentRenderable(safe, {
        componentInstanceId: this.id,
        phase: "ready",
        props: snapshot.props,
        state: snapshot.state,
        revision: snapshot.revision,
      });
      if (this.messageRef) {
        await this.delivery.update(this.messageRef, ir);
      } else {
        this.messageRef = await this.delivery.post(ir);
      }
    }
    this.terminal = true;
  }

  async setState(next: unknown, freshRef: MessageRef): Promise<void> {
    const update = this.stateTail.then(() => this.applyState(next, freshRef));
    this.stateTail = update.then(
      () => undefined,
      () => undefined,
    );
    await update;
  }

  private async applyState(next: unknown, freshRef: MessageRef): Promise<void> {
    if (!this.stateful || this.state === undefined) {
      throw new Error("This Channel component has no local state.");
    }
    const persisted = await this.store.getInstance(this.id);
    if (persisted?.state !== undefined) {
      this.state = persisted.state;
    }
    const resolved =
      typeof next === "function"
        ? (next as (current: JsonValue) => unknown)(this.state)
        : next;
    this.state = snapshotComponentState(resolved);
    this.messageRef = freshRef;
    const props = this.latestProps ?? {};
    const phase = this.terminal ? "ready" : "streaming";
    try {
      const ui =
        phase === "ready"
          ? this.renderReady(props)
          : this.renderStreaming(props, this.latestReadiness);
      await this.enqueue(phase, props, ui, false);
    } catch (error) {
      await this.fail(error);
      throw error;
    }
  }

  private renderStreaming(
    props: JsonValue,
    readiness: StreamReadiness<unknown>,
  ): Renderable {
    return this.render({
      phase: "streaming",
      platform: this.delivery.platform,
      props,
      state: this.state,
      revision: this.revision + 1,
      callbacks: createChannelComponentCallbackBinders(
        this.definition.callbacks ?? {},
      ),
      status: (...path: readonly (string | number)[]) =>
        getStreamStatus(readiness, path as never),
    });
  }

  private renderReady(props: JsonValue): Renderable {
    return this.render({
      phase: "ready",
      platform: this.delivery.platform,
      props,
      state: this.state,
      revision: this.revision + 1,
      callbacks: createChannelComponentCallbackBinders(
        this.definition.callbacks ?? {},
      ),
    });
  }

  private render(context: object): Renderable {
    const rendered = this.definition.render(context as never);
    if (isThenable(rendered)) {
      throw new TypeError("Channel component render() must be synchronous.");
    }
    return rendered;
  }

  private offer(
    phase: "streaming" | "ready",
    props: JsonValue,
    ui: Renderable,
    terminal: boolean,
  ): void {
    const promise = this.enqueue(phase, props, ui, terminal);
    this.pending.push(
      promise.catch((error) => {
        this.streamError ??= error;
      }),
    );
  }

  private enqueue(
    phase: "streaming" | "ready",
    props: JsonValue,
    ui: Renderable,
    terminal: boolean,
  ): Promise<unknown> {
    const snapshot = this.snapshot(phase, props);
    return this.queue.enqueue({
      revision: snapshot.revision,
      value: { snapshot, ui },
      terminal,
    });
  }

  private snapshot(
    phase: "streaming" | "ready" | "failed",
    props: JsonValue,
    error?: ChannelComponentErrorSnapshot,
  ): ChannelComponentInstanceSnapshot {
    this.revision += 1;
    return {
      version: 1,
      componentName: this.definition.name,
      phase,
      props,
      ...(this.state !== undefined ? { state: this.state } : {}),
      revision: this.revision,
      ...(error ? { error } : {}),
    };
  }
}

async function updateColdReadyState(
  id: string,
  next: unknown,
  context: InteractionContext,
  definitions: ReadonlyMap<string, ChannelComponentDefinition>,
  store: ChannelComponentStore,
  registry: ActionRegistry,
  options: {
    sleep?: (milliseconds: number) => Promise<void>;
    retryDelayMs?: (attempt: number) => number;
    maxAttempts?: number;
  },
): Promise<void> {
  const current = await store.getInstance(id);
  if (!current || current.phase !== "ready" || current.state === undefined) {
    throw new Error("This Channel component state is no longer available.");
  }
  const definition = definitions.get(current.componentName);
  if (!definition)
    throw new Error("This Channel component is no longer registered.");
  const state = snapshotComponentState(
    typeof next === "function"
      ? (next as (value: JsonValue) => unknown)(current.state)
      : next,
  );
  const snapshot: ChannelComponentInstanceSnapshot = {
    ...current,
    state,
    revision: current.revision + 1,
  };
  await store.putInstance(id, snapshot);
  try {
    const ui = definition.render({
      phase: "ready",
      platform: context.platform,
      props: snapshot.props,
      state,
      revision: snapshot.revision,
      callbacks: createChannelComponentCallbackBinders(
        definition.callbacks ?? {},
      ),
    } as never);
    if (isThenable(ui)) {
      throw new TypeError("Channel component render() must be synchronous.");
    }
    const ir = await registry.bindComponentRenderable(ui, {
      componentInstanceId: id,
      phase: "ready",
      props: snapshot.props,
      state,
      revision: snapshot.revision,
    });
    await retryInteractionUpdate(context, ir, options);
  } catch (error) {
    const failed: ChannelComponentInstanceSnapshot = {
      ...snapshot,
      phase: "failed",
      revision: snapshot.revision + 1,
      error: componentError(error),
    };
    await store.putInstance(id, failed);
    await replaceFailedInteraction(
      id,
      definition,
      failed,
      context,
      registry,
      options,
    );
    throw error;
  }
}

async function replaceFailedInteraction(
  id: string,
  definition: ChannelComponentDefinition,
  snapshot: ChannelComponentInstanceSnapshot,
  context: InteractionContext,
  registry: ActionRegistry,
  options: {
    sleep?: (milliseconds: number) => Promise<void>;
    retryDelayMs?: (attempt: number) => number;
    maxAttempts?: number;
  },
): Promise<void> {
  try {
    const ui = renderFailed(definition, snapshot, context.platform);
    const ir = await registry.bindComponentRenderable(ui, {
      componentInstanceId: id,
      phase: "ready",
      props: snapshot.props,
      state: snapshot.state,
      revision: snapshot.revision,
    });
    await retryInteractionUpdate(context, ir, options);
  } catch {
    const safe = Section({
      children: "This component could not be displayed.",
    });
    const ir = await registry.bindComponentRenderable(safe, {
      componentInstanceId: id,
      phase: "ready",
      props: snapshot.props,
      state: snapshot.state,
      revision: snapshot.revision,
    });
    await retryInteractionUpdate(context, ir, options);
  }
}

async function retryInteractionUpdate(
  context: InteractionContext,
  ir: ChannelNode[],
  options: {
    sleep?: (milliseconds: number) => Promise<void>;
    retryDelayMs?: (attempt: number) => number;
    maxAttempts?: number;
  } = {},
): Promise<void> {
  const policy = componentThread(context).ɵchannelComponentDeliveryPolicy?.();
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? policy?.maxAttempts ?? 1;
  const retryDelayMs =
    options.retryDelayMs ?? policy?.retryDelayMs ?? (() => 0);
  let attempt = 1;
  while (true) {
    try {
      await componentThread(context).ɵupdateChannelComponent(
        context.message.ref,
        ir,
      );
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await sleep(retryDelayMs(attempt));
      attempt += 1;
    }
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function renderFailed(
  definition: ChannelComponentDefinition,
  snapshot: ChannelComponentInstanceSnapshot,
  platform: string,
): Renderable {
  try {
    const rendered = definition.render({
      phase: "failed",
      platform,
      props: snapshot.props,
      state: snapshot.state,
      revision: snapshot.revision,
      error: snapshot.error,
    } as never);
    if (!isThenable(rendered)) return rendered;
  } catch {
    // Fall through to the SDK-owned safe failure view.
  }
  return Section({ children: "This component could not be displayed." });
}

function componentError(error: unknown): ChannelComponentErrorSnapshot {
  const candidate = error as Partial<ChannelComponentErrorSnapshot>;
  return {
    code:
      typeof candidate?.code === "string"
        ? candidate.code
        : "channel_component_failed",
    message: asError(error).message,
    ...(typeof candidate?.index === "number" ? { index: candidate.index } : {}),
    ...(typeof candidate?.line === "number" ? { line: candidate.line } : {}),
    ...(typeof candidate?.column === "number"
      ? { column: candidate.column }
      : {}),
    ...(typeof candidate?.limit === "number" ? { limit: candidate.limit } : {}),
    ...(typeof candidate?.observed === "number"
      ? { observed: candidate.observed }
      : {}),
  };
}

function componentThread(context: InteractionContext): {
  ɵupdateChannelComponent(ref: MessageRef, ir: ChannelNode[]): Promise<void>;
  ɵchannelComponentDeliveryPolicy?():
    | ChannelComponentDeliveryPolicy
    | undefined;
} {
  const thread = context.thread as unknown as {
    ɵupdateChannelComponent?: (
      ref: MessageRef,
      ir: ChannelNode[],
    ) => Promise<void>;
  };
  if (!thread.ɵupdateChannelComponent) {
    throw new Error("The current Channel surface cannot replace a component.");
  }
  return thread as Required<typeof thread>;
}

function formatIssues(issues: readonly unknown[]): string {
  return issues
    .map((issue) =>
      typeof issue === "object" && issue !== null && "message" in issue
        ? String(issue.message)
        : String(issue),
    )
    .join("; ");
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return Object.assign(new Error(error.message), error);
  }
  return new Error(String(error));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
