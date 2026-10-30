import type {
  ChannelNode,
  ClickHandler,
  InteractionContext,
  ComponentFn,
  Renderable,
  MessageReactionHandler,
} from "@copilotkit/channels-ui";
import {
  isBound,
  getBoundArgs,
  renderToIR,
  isHostElement,
} from "@copilotkit/channels-ui";
import type { ChannelComponentRenderContext } from "./channel-component.js";
import { mintActionId } from "./mint-id.js";
import { BoundedCache } from "./bounded-cache.js";
import type {
  ActionContinuationContext,
  ActionContinuationBinding,
  ActionContinuationSnapshot,
  ActionSnapshot,
  ActionStore,
} from "./action-store.js";

export class ActionExpiredError extends Error {
  readonly code = "channel_action_expired";

  constructor(id: string) {
    super(`Action "${id}" has expired or is no longer available.`);
    this.name = "ActionExpiredError";
  }
}

/** A continuation capability was presented outside its trusted Channel binding. */
export class ActionContinuationMismatchError extends Error {
  readonly code = "channel_continuation_mismatch";

  constructor() {
    super("The Channel continuation does not match this interaction");
    this.name = "ActionContinuationMismatchError";
  }
}

/** An action id was presented from outside the conversation it was minted for. */
export class ActionScopeMismatchError extends Error {
  readonly code = "channel_action_scope_mismatch";

  constructor() {
    super("The action does not belong to this conversation");
    this.name = "ActionScopeMismatchError";
  }
}

/** An action limited to its initiator was used by another provider account. */
export class ActionInitiatorMismatchError extends Error {
  readonly code = "channel_action_not_initiator";

  constructor() {
    super("Only the initiator may use this action");
    this.name = "ActionInitiatorMismatchError";
  }
}

/** Another control of the same interrupt already resumed it. */
export class ActionAlreadyClaimedError extends Error {
  readonly code = "channel_action_already_claimed";

  constructor() {
    super("This interrupt has already been answered");
    this.name = "ActionAlreadyClaimedError";
  }
}

/**
 * Server-derived facts about where an interaction arrived, checked on dispatch.
 * Both come from the ingress event, never from the action payload.
 */
export interface ActionDispatchScope {
  /** Conversation the interaction arrived in. Must be non-empty. */
  conversationKey: string;
  /** Platform the interaction arrived on. */
  platform: string;
}

/**
 * Where an action or reaction handler was bound. `platform` is absent from
 * snapshots written before actions were scoped by platform; such a snapshot
 * matches on its conversation key alone.
 */
interface ActionBinding {
  conversationKey: string;
  platform?: string;
}

const EVENT_PROPS = ["onClick", "onSelect", "onSubmit"] as const;

/**
 * How long a bound action (and a message's reaction handler) stays
 * dispatchable: 7 days. Applies to the durable snapshot and to the in-process
 * cache alike.
 */
export const DEFAULT_ACTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Most bound actions (and, separately, message reaction handlers) the
 * in-process cache holds. Past it the least recently used entry is evicted; a
 * registered component's action is then re-derived from its durable snapshot,
 * and an inline handler reports {@link ActionExpiredError}.
 */
export const DEFAULT_MAX_HOT_ACTIONS = 10_000;

function isComponentElement(
  ui: unknown,
): ui is { type: ComponentFn; props: Record<string, unknown> } {
  return (
    typeof ui === "object" &&
    ui !== null &&
    typeof (ui as { type?: unknown }).type === "function"
  );
}

export class ActionRegistry {
  private store: ActionStore;
  private components = new Map<
    string,
    {
      render: (
        props: Record<string, unknown>,
        context: ChannelComponentRenderContext,
      ) => Renderable | Promise<Renderable>;
      requireKeys: boolean;
      /** What the name was registered for (see {@link registerComponent}). */
      source: object;
    }
  >();
  /** The registration name of each registered component function. */
  private componentNames = new WeakMap<object, string>();
  // Cache, per minted id, the handler, the element's `value` (dispatch returns
  // it, since a platform may drop it from the callback payload: Discord drops
  // a value too large for its custom_id), and the conversation and platform
  // the action was bound in, which dispatch checks. Every render mints fresh
  // ids, so the cache is bounded: entries expire with the retention window
  // and the least recently used one is evicted past the size cap.
  private hot: BoundedCache<
    string,
    {
      handler: ClickHandler;
      value: unknown;
      conversationKey: string;
      platform: string;
      continuation?: true;
    }
  >;
  // Same-process fast path for `<Message onReaction>` handlers, keyed by the
  // posted message's id, with the conversation the message was posted to.
  // Mirrors the `hot` action cache; the durable snapshot (below) is the
  // cross-restart counterpart, exactly like onClick.
  private messageReactions: BoundedCache<
    string,
    { handler: MessageReactionHandler } & ActionBinding
  >;

  // Ids this process revoked or claimed, so a re-scope racing with either
  // cannot write the action back (see `rescopeActions`).
  private retired: BoundedCache<string, true>;

  // Each in-process continuation's gate: when it was opened, and the write
  // every bind of that leg waits on, so binds running together share one gate.
  private resumeGates = new WeakMap<
    ActionContinuationContext,
    { openedAt: number; opened: Promise<void> }
  >();

  /** TTL of every stored snapshot and of every in-process cache entry. */
  private readonly retentionMs: number;

  /**
   * @param opts.retentionMs How long a bound action stays dispatchable, in the
   *   store and in process. Default {@link DEFAULT_ACTION_RETENTION_MS}.
   * @param opts.maxHotActions Size cap of each in-process cache (actions, and
   *   message reaction handlers). Default {@link DEFAULT_MAX_HOT_ACTIONS}.
   */
  constructor(opts: {
    store: ActionStore;
    retentionMs?: number;
    maxHotActions?: number;
  }) {
    this.store = opts.store;
    this.retentionMs = opts.retentionMs ?? DEFAULT_ACTION_RETENTION_MS;
    const limits = {
      maxEntries: opts.maxHotActions ?? DEFAULT_MAX_HOT_ACTIONS,
      ttlMs: this.retentionMs,
    };
    this.hot = new BoundedCache(limits);
    this.messageReactions = new BoundedCache(limits);
    this.retired = new BoundedCache(limits);
  }

  /** Cache a `<Message onReaction>` handler for the posted message (same-process). */
  registerMessageReaction(
    messageId: string,
    handler: MessageReactionHandler,
    binding: { conversationKey: string; platform: string },
  ): void {
    this.messageReactions.set(messageId, { handler, ...binding });
  }

  /**
   * Persist the message's reaction handler as a `{ component, props }` snapshot
   * keyed by `messageId`, so a reaction after a restart re-renders the component
   * and re-derives the handler — durable exactly like a registered-component
   * `onClick` (and degrading the same way for inline/anonymous components).
   */
  async persistMessageReaction(
    messageId: string,
    snap: {
      component: string;
      props: Record<string, unknown>;
      conversationKey: string;
      platform?: string;
    },
  ): Promise<void> {
    await this.store.put(
      reactionKey(messageId),
      {
        component: snap.component,
        props: snap.props,
        path: [],
        conversationKey: snap.conversationKey,
        platform: snap.platform,
      },
      this.retentionMs,
    );
  }

  /**
   * Resolve the `onReaction` handler for `messageId`: the hot cache first, then
   * the durable snapshot (re-rendering the named component and re-plucking the
   * root's handler). Returns `undefined` when neither resolves — e.g. an inline
   * handler whose closure can't be re-derived after a restart.
   *
   * `scope` is where the reaction arrived (server-derived). A handler bound in
   * another conversation or on another platform is refused with
   * {@link ActionScopeMismatchError}.
   */
  async resolveMessageReaction(
    messageId: string,
    scope: ActionDispatchScope,
  ): Promise<MessageReactionHandler | undefined> {
    assertDispatchScope(scope);
    const hot = this.messageReactions.get(messageId);
    if (hot) {
      assertActionScope(hot, scope);
      return hot.handler;
    }
    const snap = await this.store.get(reactionKey(messageId));
    if (!snap) return undefined;
    if (lacksConversationBinding(snap)) {
      // The message id is a provider id, so it stays out of the log.
      warnLegacyBinding("a reaction");
      return undefined;
    }
    assertActionScope(snap, scope);
    if (!snap.component) return undefined;
    const registered = this.components.get(snap.component);
    if (!registered) return undefined;
    const root = renderToIR(
      await registered.render(snap.props as Record<string, unknown>, {
        platform: (snap.platform ??
          scope.platform) as ChannelComponentRenderContext["platform"],
        signal: new AbortController().signal,
      }),
    );
    return takeMessageReaction(root);
  }

  /**
   * Register a component under an explicit `name`, the identity its durable
   * snapshots record. A cold dispatch (after a restart or an eviction)
   * re-renders the component by this name, so a name stands for exactly one
   * component: registering it for a different one throws, and so does
   * registering one component under two names. Re-registering the same
   * component under the same name is harmless.
   *
   * @param options.source The component the name identifies when `fn` wraps
   *   it (defaults to `fn`). A posted element whose `type` is `source` binds
   *   under `name`; an element of an unregistered function binds inline.
   */
  registerComponent(
    name: string,
    fn: (
      props: Record<string, unknown>,
      context: ChannelComponentRenderContext,
    ) => Renderable | Promise<Renderable>,
    options: { requireKeys?: boolean; source?: object } = {},
  ): void {
    const source = options.source ?? fn;
    const existing = this.components.get(name);
    if (existing && existing.source !== source) {
      throw new Error(
        `Channel component "${name}" is already registered for a different component`,
      );
    }
    const registeredAs = this.componentNames.get(source);
    if (registeredAs !== undefined && registeredAs !== name) {
      throw new Error(
        `Channel component "${name}" is already registered as "${registeredAs}"`,
      );
    }
    this.components.set(name, {
      render: fn,
      requireKeys: options.requireKeys ?? false,
      source,
    });
    this.componentNames.set(source, name);
  }

  clearHotCache(): void {
    this.hot.clear();
  }

  // Renders the named component, binds all event-prop handlers in the tree
  // (mint id, hot-cache + ActionStore snapshot, rewrite prop to { id }), returns the bound IR.
  async bindTree(
    componentName: string,
    props: Record<string, unknown>,
    conversationKey: string,
    continuation?: ActionContinuationContext,
    renderContext: ChannelComponentRenderContext = {
      platform: "slack",
      signal: new AbortController().signal,
    },
  ): Promise<ChannelNode[]> {
    const registered = this.components.get(componentName);
    const rendered = registered
      ? await registered.render(props, renderContext)
      : (props as unknown as Renderable);
    const root = renderToIR(rendered);
    const interactiveKeys = new Set<string | number>();
    await this.walk(
      root,
      [],
      componentName,
      props,
      conversationKey,
      continuation,
      registered?.requireKeys ?? false,
      renderContext.platform,
      interactiveKeys,
    );
    return root;
  }

  /** Bind a named component and detach its root reaction for message routing. */
  async bindRegisteredRenderable(
    componentName: string,
    props: Record<string, unknown>,
    conversationKey: string,
    continuation: ActionContinuationContext | undefined,
    renderContext: ChannelComponentRenderContext,
  ): Promise<{
    root: ChannelNode[];
    onReaction?: MessageReactionHandler;
    reactionComponent?: {
      component: string;
      props: Record<string, unknown>;
      platform: string;
    };
  }> {
    const root = await this.bindTree(
      componentName,
      props,
      conversationKey,
      continuation,
      renderContext,
    );
    const onReaction = takeMessageReaction(root);
    return {
      root,
      onReaction,
      reactionComponent: onReaction
        ? { component: componentName, props, platform: renderContext.platform }
        : undefined,
    };
  }

  // Binds an arbitrary Renderable for posting. If `ui` is an element of a
  // component registered by name (`registerComponent`), it is bound under
  // that name (cold-path re-render supported). Anything else, including an
  // element of an unregistered function, is bound inline with `component:""`:
  // a cold-cache dispatch then throws ActionExpiredError (intended
  // degradation for handlers that can't be re-derived). A function's own
  // `name` is never an identity: two functions can share one, and anonymous
  // ones all would. A top-level `<Message onReaction>` handler is pulled off
  // the IR (so it never reaches the adapter) and returned for the caller to
  // associate with the posted message.
  async bindRenderable(
    ui: Renderable,
    conversationKey: string,
    continuation?: ActionContinuationContext,
    renderContext: ChannelComponentRenderContext = {
      platform: "slack",
      signal: new AbortController().signal,
    },
  ): Promise<{
    root: ChannelNode[];
    onReaction?: MessageReactionHandler;
    /**
     * The component + props to persist for durable reaction routing, present
     * only when `ui` was a component element with an `onReaction` (an inline IR
     * tree has no component to re-render, so its handler stays in-memory).
     */
    reactionComponent?: {
      component: string;
      props: Record<string, unknown>;
      platform: string;
    };
  }> {
    let root: ChannelNode[];
    let component: string | undefined;
    let props: Record<string, unknown> | undefined;
    const registeredName = isComponentElement(ui)
      ? this.componentNames.get(ui.type)
      : undefined;
    if (isComponentElement(ui) && registeredName !== undefined) {
      component = registeredName;
      props = (ui.props ?? {}) as Record<string, unknown>;
      root = await this.bindTree(
        component,
        props,
        conversationKey,
        continuation,
        renderContext,
      );
    } else {
      root = renderToIR(ui);
      await this.walk(
        root,
        [],
        "",
        undefined,
        conversationKey,
        continuation,
        false,
        renderContext.platform,
        new Set(),
      );
    }
    const onReaction = takeMessageReaction(root);
    return {
      root,
      onReaction,
      reactionComponent:
        onReaction && component && props
          ? { component, props, platform: renderContext.platform }
          : undefined,
    };
  }

  private async walk(
    nodes: ChannelNode[],
    base: (string | number)[],
    comp: string,
    props: unknown,
    conv: string,
    continuation: ActionContinuationContext | undefined,
    requireKeys: boolean,
    platform: string,
    interactiveKeys: Set<string | number>,
    exactPath?: (string | number)[],
  ): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      // Snapshot callbacks are application props, not native channel actions.
      if (node.type === "render" || isHostElement(node)) continue;
      const path: (string | number)[] = exactPath ?? [...base, i];
      const eventProps = EVENT_PROPS.filter(
        (eventProp) => typeof node.props[eventProp] === "function",
      );
      if (requireKeys && eventProps.length > 0) {
        if (
          node.key === undefined ||
          (typeof node.key === "string" && node.key.trim().length === 0)
        ) {
          throw new Error(
            `${formatComponentPath(comp, path)}.${eventProps[0]} requires a non-empty JSX key`,
          );
        }
        if (interactiveKeys.has(node.key)) {
          throw new Error(`duplicate interactive JSX key "${node.key}"`);
        }
        interactiveKeys.add(node.key);
      }
      for (const ep of EVENT_PROPS) {
        const handler = node.props[ep];
        if (typeof handler === "function") {
          const fullPath: (string | number)[] = [...path, ep];
          const locator =
            requireKeys && node.key !== undefined
              ? { key: node.key, eventProp: ep }
              : undefined;
          if (continuation) await this.ensureResumeGate(continuation);
          // Every id is random and bound to its conversation: a content-derived
          // id would collide across conversations rendering the same card.
          // Continuation ids use the same format; the snapshot's
          // `continuation` record is what makes one a continuation.
          const id = mintActionId();
          this.hot.set(id, {
            handler: handler as ClickHandler,
            value: node.props.value,
            conversationKey: conv,
            platform,
            ...(continuation ? { continuation: true as const } : {}),
          });
          await this.store.put(
            id,
            {
              component: comp,
              props,
              path: fullPath,
              ...(locator ? { locator } : {}),
              platform,
              actionValue: node.props.value,
              conversationKey: conv,
              boundArgs: isBound(handler) ? getBoundArgs(handler) : undefined,
              ...(continuation
                ? { continuation: { ...continuation, actionId: id } }
                : {}),
            },
            this.retentionMs,
          );
          node.props[ep] = { id };
        }
      }
      for (const [propName, propValue] of Object.entries(node.props)) {
        if ((EVENT_PROPS as readonly string[]).includes(propName)) continue;
        await this.walkValue(
          propValue,
          [...path, propName],
          comp,
          props,
          conv,
          continuation,
          requireKeys,
          platform,
          interactiveKeys,
        );
      }
    }
  }

  /** Traverse children and provider-native named slots through one path model. */
  private async walkValue(
    value: unknown,
    path: (string | number)[],
    comp: string,
    props: unknown,
    conv: string,
    continuation: ActionContinuationContext | undefined,
    requireKeys: boolean,
    platform: string,
    interactiveKeys: Set<string | number>,
  ): Promise<void> {
    if (isChannelNode(value)) {
      await this.walkNode(
        value,
        path,
        comp,
        props,
        conv,
        continuation,
        requireKeys,
        platform,
        interactiveKeys,
      );
      return;
    }
    if (!Array.isArray(value)) return;
    for (let index = 0; index < value.length; index++) {
      await this.walkValue(
        value[index],
        [...path, index],
        comp,
        props,
        conv,
        continuation,
        requireKeys,
        platform,
        interactiveKeys,
      );
    }
  }

  /** Bind one node reached through a singular provider-native slot. */
  private async walkNode(
    node: ChannelNode,
    path: (string | number)[],
    comp: string,
    props: unknown,
    conv: string,
    continuation: ActionContinuationContext | undefined,
    requireKeys: boolean,
    platform: string,
    interactiveKeys: Set<string | number>,
  ): Promise<void> {
    await this.walk(
      [node],
      [],
      comp,
      props,
      conv,
      continuation,
      requireKeys,
      platform,
      interactiveKeys,
      path,
    );
  }

  /**
   * Run the click handler for `id` and return the clicked element's `value`
   * (so callers can resolve a HITL `awaitChoice` waiter even when the platform
   * couldn't carry the value in its callback payload). Returns `undefined` when
   * the element has no `value`.
   *
   * `scope` is where the interaction actually arrived (server-derived from the
   * ingress event); omitting it is a `TypeError`. An id bound to a different
   * conversation or platform, or to an empty conversation key, is refused with
   * {@link ActionScopeMismatchError} before any handler runs.
   *
   * Order of checks: the scope is checked first whenever the binding is known
   * (a hot entry, or a stored snapshot — inline ones included). An id with no
   * binding at all (never minted, or its snapshot has expired) has no scope to
   * check and raises {@link ActionExpiredError}.
   */
  async dispatch(
    id: string,
    ctx: InteractionContext,
    scope: ActionDispatchScope,
  ): Promise<unknown> {
    assertDispatchScope(scope);
    let handler: ClickHandler | undefined;
    let value: unknown;
    const hot = this.hot.get(id);
    if (hot) {
      assertActionScope(hot, scope);
      if (hot.continuation && !(await this.store.get(id))) {
        this.hot.delete(id);
        throw await this.goneError(id, scope);
      }
      handler = hot.handler;
      value = hot.value;
    } else {
      const snap = await this.store.get(id);
      if (!snap) throw await this.goneError(id, scope);
      if (lacksConversationBinding(snap)) {
        warnLegacyBinding(`action ${id}`);
        throw new ActionExpiredError(id);
      }
      assertActionScope(snap, scope);
      // A picker's owner map is per process: on any other replica, or after a
      // restart, the snapshot is what still knows the owner.
      if (
        snap.ownerActorId !== undefined &&
        snap.ownerActorId !== ctx.actor.id
      ) {
        throw new ActionInitiatorMismatchError();
      }
      if (!snap.component) throw new ActionExpiredError(id);
      const registered = this.components.get(snap.component);
      if (!registered) throw new ActionExpiredError(id);
      const tree = renderToIR(
        await registered.render(snap.props as Record<string, unknown>, {
          platform: (snap.platform ??
            scope.platform) as ChannelComponentRenderContext["platform"],
          signal: new AbortController().signal,
        }),
      );
      handler = snap.locator
        ? findHandlerByLocator(tree, snap.locator)
        : pluck(tree, snap.path);
      value = snap.locator ? snap.actionValue : pluckValue(tree, snap.path);
      if (!handler) throw new ActionExpiredError(id);
    }
    // Revoked while it was being resolved (its snapshot may outlive a failed
    // or still-pending delete): it never runs.
    if (this.retired.get(id)) throw new ActionExpiredError(id);
    const actionValue = value === undefined ? ctx.action.value : value;
    await handler({
      ...ctx,
      action: { ...ctx.action, id, value: actionValue },
    });
    return value;
  }

  /**
   * @internal Re-scope every action bound in `root` to the conversation a
   * click on the posted message arrives from.
   *
   * Actions are bound before their message is posted, under the posting
   * turn's key. Some platforms key a click on the posted message differently
   * (Slack keys a click on a top-level message by that message's own ts), so
   * once the message is posted the Thread moves the binding to the key the
   * click will carry (see `PlatformAdapter.postedConversationKey`). A
   * continuation's binding moves with it (to `threadId` too, when given), so
   * `Thread.resume()` from that click matches it. The stored snapshot and the
   * in-process entry both get a fresh retention window, up to the deadline of
   * any gate the action shares. An action revoked or consumed while it was
   * being re-scoped stays gone.
   */
  async rescopeActions(
    root: readonly ChannelNode[],
    binding: { conversationKey: string; threadId?: string },
  ): Promise<void> {
    const { conversationKey, threadId } = binding;
    for (const id of boundActionIds(root)) {
      const hot = this.hot.get(id);
      if (hot) this.hot.set(id, { ...hot, conversationKey });
      const snap = await this.store.get(id);
      if (!snap) continue;
      await this.store.put(
        id,
        {
          ...snap,
          conversationKey,
          ...(snap.continuation
            ? {
                continuation: {
                  ...snap.continuation,
                  conversationKey,
                  ...(threadId !== undefined ? { threadId } : {}),
                },
              }
            : {}),
        },
        this.renewalTtl(snap),
      );
      // The read and the write above are not atomic: an action revoked or
      // claimed in between must not come back.
      if (this.retired.get(id)) {
        this.hot.delete(id);
        await this.store.delete(id);
      }
    }
  }

  /**
   * @internal Persist the provider account a picker's controls are limited to.
   * Runs before the controls are published, so no click can race the write.
   * Ids without a snapshot (controls with no handler) are ignored.
   */
  async setActionOwner(ids: Iterable<string>, actorId: string): Promise<void> {
    for (const id of ids) {
      const snap = await this.store.get(id);
      if (snap) {
        await this.store.put(
          id,
          { ...snap, ownerActorId: actorId },
          this.renewalTtl(snap),
        );
      }
    }
  }

  /**
   * @internal Revoke actions so they can never be dispatched again (an
   * answered or abandoned picker's controls). Unknown ids are ignored.
   *
   * Every id is retired, in process, before this returns its promise: a
   * dispatch that starts after the call refuses all of them, whatever the
   * store is doing. Each stored snapshot is then deleted; one delete failing
   * does not stop the others, and the promise rejects once they have all
   * settled if any failed. A retired id stays refused here even while its
   * snapshot survives a failed delete.
   */
  async revokeActions(ids: Iterable<string>): Promise<void> {
    const revoked = [...ids];
    for (const id of revoked) {
      this.retired.set(id, true);
      this.hot.delete(id);
    }
    const results = await Promise.allSettled(
      revoked.map(async (id) => this.store.delete(id)),
    );
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        `could not delete ${failures.length} of ${revoked.length} revoked action snapshot(s)`,
      );
    }
  }

  /** Read and validate one continuation capability without consuming it. */
  async getContinuation(
    id: string,
    expected: ActionContinuationBinding,
  ): Promise<ActionContinuationSnapshot> {
    const available = await this.store.get(id);
    if (!available) throw await this.goneError(id);
    if (!available.continuation) throw new ActionExpiredError(id);
    assertContinuationBinding(available.continuation, id, expected);
    const { resumeGateId } = available.continuation;
    if (resumeGateId && !(await this.store.get(resumeGateKey(resumeGateId)))) {
      throw new ActionAlreadyClaimedError();
    }
    return available.continuation;
  }

  /**
   * Open the one-shot gate shared by every action a run leg renders, once, on
   * the first of them. `ActionStore.consume` is the only atomic step every
   * store has, so the gate is an entry to take rather than a marker to set.
   * Actions bind within `retentionMs` of the gate opening and renew only up to
   * `resumeGateDeadline`, which the gate outlives, so a live action always
   * finds it. A leg rendering past `retentionMs` gets a new gate rather than a
   * renewed one: a `put` could bring back a consumed gate. A failed write
   * leaves the continuation untouched: the bind rejects, so nothing is
   * published, and the next bind opens the gate again.
   */
  private ensureResumeGate(
    continuation: ActionContinuationContext,
  ): Promise<void> {
    const current = this.resumeGates.get(continuation);
    if (current && Date.now() - current.openedAt < this.retentionMs) {
      return current.opened;
    }
    const openedAt = Date.now();
    const id = mintActionId();
    const opened = this.store
      .put(
        resumeGateKey(id),
        { path: [], conversationKey: "" },
        this.resumeGateTtl(),
      )
      .then(() => {
        continuation.resumeGateId = id;
        continuation.resumeGateDeadline = openedAt + this.retentionMs * 2;
      });
    const gate = { openedAt, opened };
    this.resumeGates.set(continuation, gate);
    opened.catch(() => {
      if (this.resumeGates.get(continuation) === gate) {
        this.resumeGates.delete(continuation);
      }
    });
    return opened;
  }

  /** A full `retentionMs` past `resumeGateDeadline`, whatever the store's latency. */
  private resumeGateTtl(): number {
    return this.retentionMs * 3;
  }

  /** The window for renewing `snap`: never past its gate's deadline. */
  private renewalTtl(snap: ActionSnapshot): number {
    const deadline = snap.continuation?.resumeGateDeadline;
    if (deadline === undefined) return this.retentionMs;
    // A zero TTL would mean no expiry at all.
    return Math.max(1, Math.min(this.retentionMs, deadline - Date.now()));
  }

  /** Why an id with no snapshot is gone: spent by a resume, or expired. */
  private async goneError(
    id: string,
    scope?: ActionDispatchScope,
  ): Promise<Error> {
    const spent = await this.store.get(spentKey(id));
    if (!spent) return new ActionExpiredError(id);
    if (scope) assertActionScope(spent, scope);
    return new ActionAlreadyClaimedError();
  }

  /** Validate and atomically consume one continuation capability. */
  async claimContinuation(
    id: string,
    expected: ActionContinuationBinding,
  ): Promise<ActionContinuationSnapshot> {
    const available = await this.getContinuation(id, expected);
    const { resumeGateId } = available;

    // The gate goes first and alone decides the claim: if taking it fails,
    // nothing is spent and any control can retry, and once it is taken no
    // other click can start a run, so a failure removing the action is logged
    // rather than costing the run it just won.
    const gateKey = resumeGateId ? resumeGateKey(resumeGateId) : undefined;
    const gate = gateKey ? await this.store.consume(gateKey) : undefined;
    if (gateKey && !gate) throw new ActionAlreadyClaimedError();
    const claimed = await this.store.consume(id).catch((err: unknown) => {
      if (!gate) throw err;
      console.warn("[channel] could not remove a resumed action", err);
      const fallback: ActionSnapshot = {
        path: [],
        conversationKey: available.conversationKey,
        continuation: available,
      };
      return fallback;
    });
    if (!claimed?.continuation) {
      // The action went while this click held the gate, and no run has
      // started: only this holder can put the gate back, so the leg's other
      // controls stay usable.
      if (gateKey && gate) {
        await this.store
          .put(gateKey, gate, this.resumeGateTtl())
          .catch((err: unknown) => {
            console.warn("[channel] could not restore a resume gate", err);
          });
      }
      throw await this.goneError(id);
    }
    this.retired.set(id, true);
    assertContinuationBinding(claimed.continuation, id, expected);
    this.hot.delete(id);
    // Only a label for later clicks: the claim stands if this write fails.
    await this.store
      .put(
        spentKey(id),
        {
          path: [],
          conversationKey: claimed.conversationKey,
          ...(claimed.platform ? { platform: claimed.platform } : {}),
        },
        this.retentionMs,
      )
      .catch((err: unknown) => {
        console.warn("[channel] could not record a resumed action", err);
      });
    return claimed.continuation;
  }
}

/** A missing or malformed scope is a programming error, not a mismatch. */
function assertDispatchScope(
  scope: unknown,
): asserts scope is ActionDispatchScope {
  if (
    typeof scope !== "object" ||
    scope === null ||
    typeof (scope as { conversationKey?: unknown }).conversationKey !==
      "string" ||
    typeof (scope as { platform?: unknown }).platform !== "string"
  ) {
    throw new TypeError(
      "ActionRegistry requires a dispatch scope { conversationKey, platform } derived from the ingress event",
    );
  }
}

/**
 * Whether a stored snapshot predates conversation scoping: it has no
 * conversation key, so no click or reaction can be checked against it.
 */
function lacksConversationBinding(snap: ActionSnapshot): boolean {
  const key: unknown = snap.conversationKey;
  return typeof key !== "string";
}

/** Log a refused pre-upgrade snapshot (it fails closed, as expired). */
function warnLegacyBinding(what: string): void {
  console.warn(
    `[channel] refused ${what}: its stored snapshot has no conversation binding (legacy action, re-render required)`,
  );
}

/**
 * Refuse a binding presented outside the conversation and platform it was
 * bound in. An empty conversation key never matches: it would put every
 * conversation an adapter could not key into one shared scope. A binding
 * without a platform (written before actions were scoped by platform) is
 * checked on its conversation key alone.
 */
function assertActionScope(
  bound: ActionBinding,
  scope: ActionDispatchScope,
): void {
  if (
    bound.conversationKey.length === 0 ||
    scope.conversationKey !== bound.conversationKey ||
    (bound.platform !== undefined && scope.platform !== bound.platform)
  ) {
    throw new ActionScopeMismatchError();
  }
}

function assertContinuationBinding(
  actual: ActionContinuationSnapshot,
  actionId: string,
  expected: ActionContinuationBinding,
): void {
  if (
    actual.actionId !== actionId ||
    actual.channelName !== expected.channelName ||
    actual.conversationKey !== expected.conversationKey ||
    actual.threadId !== expected.threadId ||
    typeof actual.runChainId !== "string" ||
    actual.runChainId.length === 0 ||
    typeof actual.initiator?.actor?.id !== "string" ||
    (actual.initiator.user !== null &&
      typeof actual.initiator.user?.id !== "string")
  ) {
    throw new ActionContinuationMismatchError();
  }
}

function isChannelNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    typeof value.props === "object" &&
    value.props !== null
  );
}

function formatComponentPath(
  component: string,
  path: (string | number)[],
): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}.${segment}`,
    component,
  );
}

function findHandlerByLocator(
  tree: ChannelNode[],
  locator: {
    key: string | number;
    eventProp: (typeof EVENT_PROPS)[number];
  },
): ClickHandler | undefined {
  const matches: ClickHandler[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isChannelNode(value)) return;
    if (value.key === locator.key) {
      const handler = value.props[locator.eventProp];
      if (typeof handler === "function") matches.push(handler as ClickHandler);
    }
    for (const propValue of Object.values(value.props)) visit(propValue);
  };
  visit(tree);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Every registry-minted `{ id }` reference in a bound tree, provider-native slots included. */
function boundActionIds(root: readonly ChannelNode[]): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isChannelNode(value)) return;
    for (const [propName, propValue] of Object.entries(value.props)) {
      if (
        (EVENT_PROPS as readonly string[]).includes(propName) &&
        typeof propValue === "object" &&
        propValue !== null &&
        "id" in propValue &&
        typeof propValue.id === "string"
      ) {
        ids.push(propValue.id);
      } else {
        visit(propValue);
      }
    }
  };
  visit(root);
  return ids;
}

/** Store key for an interrupt's one-shot resume gate. */
function resumeGateKey(id: string): string {
  return `resume:${id}`;
}

/** Store key recording that a resume spent action `id`. */
function spentKey(id: string): string {
  return `resume:spent:${id}`;
}

/** Store key for a message's durable reaction snapshot (distinct from minted action ids). */
function reactionKey(messageId: string): string {
  return `reaction:${messageId}`;
}

/**
 * Pull a top-level `<Message onReaction>` handler off the IR, deleting the prop
 * so it never reaches the adapter (a function can't be serialized to a native
 * payload). Returns the handler when the single root node is a `message`.
 */
function takeMessageReaction(
  root: ChannelNode[],
): MessageReactionHandler | undefined {
  const node = root.length === 1 ? root[0] : undefined;
  if (!node || node.type !== "message" || !("onReaction" in node.props)) {
    return undefined;
  }
  const handler = node.props.onReaction;
  delete node.props.onReaction;
  return typeof handler === "function"
    ? (handler as MessageReactionHandler)
    : undefined;
}

/** Navigate to the node owning the event-prop at `path` and read its `value`. */
function pluckValue(tree: ChannelNode[], path: (string | number)[]): unknown {
  let cur: unknown = tree;
  for (const seg of path.slice(0, -1)) {
    if (Array.isArray(cur)) cur = cur[seg as number];
    else if (cur && typeof cur === "object")
      cur = (cur as ChannelNode).props?.[seg as string];
    else return undefined;
  }
  return (cur as ChannelNode | undefined)?.props?.value;
}

function pluck(
  tree: ChannelNode[],
  path: (string | number)[],
): ClickHandler | undefined {
  let cur: unknown = tree;
  for (const seg of path.slice(0, -1)) {
    if (Array.isArray(cur)) cur = cur[seg as number];
    else if (cur && typeof cur === "object")
      cur = (cur as ChannelNode).props?.[seg as string];
    else return undefined;
  }
  const ep = path[path.length - 1] as string;
  const node = cur as ChannelNode | undefined;
  const h = node?.props?.[ep];
  return typeof h === "function" ? (h as ClickHandler) : undefined;
}
