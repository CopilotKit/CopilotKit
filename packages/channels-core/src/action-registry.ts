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
  resolveComponentName,
} from "@copilotkit/channels-ui";
import { mintId } from "./mint-id.js";
import type {
  ActionContinuationContext,
  ActionContinuationBinding,
  ActionContinuationSnapshot,
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

const EVENT_PROPS = ["onClick", "onSelect", "onSubmit"] as const;

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
  private components = new Map<string, ComponentFn>();
  // Cache the handler AND the element's `value` per minted id. The value is
  // needed to resolve HITL `awaitChoice` waiters on platforms whose callback
  // payload can't carry it (e.g. Telegram's 64-byte callback_data only holds
  // the action id), where `evt.value` arrives undefined.
  private hot = new Map<
    string,
    { handler: ClickHandler; value: unknown; continuation?: true }
  >();
  // Same-process fast path for `<Message onReaction>` handlers, keyed by the
  // posted message's id. Mirrors the `hot` action cache; the durable snapshot
  // (below) is the cross-restart counterpart, exactly like onClick.
  private messageReactions = new Map<string, MessageReactionHandler>();

  private readonly retentionMs?: number;

  constructor(opts: { store: ActionStore; retentionMs?: number }) {
    this.store = opts.store;
    this.retentionMs = opts.retentionMs;
  }

  /** Cache a `<Message onReaction>` handler for the posted message (same-process). */
  registerMessageReaction(
    messageId: string,
    handler: MessageReactionHandler,
  ): void {
    this.messageReactions.set(messageId, handler);
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
    },
  ): Promise<void> {
    await this.store.put(reactionKey(messageId), {
      component: snap.component,
      props: snap.props,
      path: [],
      conversationKey: snap.conversationKey,
    });
  }

  /**
   * Resolve the `onReaction` handler for `messageId`: the hot cache first, then
   * the durable snapshot (re-rendering the named component and re-plucking the
   * root's handler). Returns `undefined` when neither resolves — e.g. an inline
   * handler whose closure can't be re-derived after a restart.
   */
  async resolveMessageReaction(
    messageId: string,
  ): Promise<MessageReactionHandler | undefined> {
    const hot = this.messageReactions.get(messageId);
    if (hot) return hot;
    const snap = await this.store.get(reactionKey(messageId));
    if (!snap?.component) return undefined;
    const fn = this.components.get(snap.component);
    if (!fn) return undefined;
    const root = renderToIR(
      fn(snap.props as Record<string, unknown>) as Renderable,
    );
    return takeMessageReaction(root);
  }

  /**
   * Register `fn` under its durable identity `name` (see
   * {@link resolveComponentName}) so a cold dispatch can re-render it.
   *
   * Two different components sharing one name is a real hazard, not a
   * curiosity: `mintId` folds the name into the action id, so equal names with
   * equal props and path mint the *same* id — and a cold dispatch then resolves
   * a handler out of the wrong component tree. Registration stays
   * last-one-wins (re-registering the same component on every post is normal,
   * and dev hot-reload legitimately swaps the function identity), but the
   * conflict is reported once so it is not silent.
   */
  registerComponent(name: string, fn: ComponentFn): void {
    const existing = this.components.get(name);
    if (existing && existing !== fn) {
      warnOnce(
        `name-conflict:${name}`,
        `[channel] two different components are registered as "${name}"; their action ids can collide and a click may run the wrong handler. Give each a distinct name via defineChannelComponent().`,
      );
    }
    this.components.set(name, fn);
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
  ): Promise<ChannelNode[]> {
    const fn = this.components.get(componentName);
    const root = renderToIR((fn ? fn(props) : props) as Renderable);
    await this.walk(
      root,
      [],
      componentName,
      props,
      conversationKey,
      continuation,
    );
    return root;
  }

  // Binds an arbitrary Renderable for posting. If `ui` is a component element
  // (`{ type: fn, props }`), it is registered + bound by name (cold-path
  // re-render supported). Otherwise the IR is bound inline with `component:""`,
  // meaning a cold-cache dispatch throws ActionExpiredError (intended
  // degradation for inline handlers that can't be re-derived). A top-level
  // `<Message onReaction>` handler is pulled off the IR (so it never reaches the
  // adapter) and returned for the caller to associate with the posted message.
  async bindRenderable(
    ui: Renderable,
    conversationKey: string,
    continuation?: ActionContinuationContext,
  ): Promise<{
    root: ChannelNode[];
    onReaction?: MessageReactionHandler;
    /**
     * The component + props to persist for durable reaction routing, present
     * only when `ui` was a component element with an `onReaction` (an inline IR
     * tree has no component to re-render, so its handler stays in-memory).
     */
    reactionComponent?: { component: string; props: Record<string, unknown> };
  }> {
    let root: ChannelNode[];
    let component: string | undefined;
    let props: Record<string, unknown> | undefined;
    if (isComponentElement(ui)) {
      const fn = ui.type;
      const resolved = resolveComponentName(fn);
      if (!resolved) {
        warnOnce(
          "anonymous-component",
          "[channel] posting a component with no resolvable name — it registers as \"anonymous\", so its action ids collide with every other unnamed component. Wrap it in defineChannelComponent('Name', fn).",
        );
      }
      component = resolved ?? "anonymous";
      props = (ui.props ?? {}) as Record<string, unknown>;
      this.registerComponent(component, fn);
      root = await this.bindTree(
        component,
        props,
        conversationKey,
        continuation,
      );
    } else {
      root = renderToIR(ui);
      await this.walk(root, [], "", undefined, conversationKey, continuation);
    }
    const onReaction = takeMessageReaction(root);
    return {
      root,
      onReaction,
      reactionComponent:
        onReaction && component && props ? { component, props } : undefined,
    };
  }

  private async walk(
    nodes: ChannelNode[],
    base: (string | number)[],
    comp: string,
    props: unknown,
    conv: string,
    continuation?: ActionContinuationContext,
  ): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const path: (string | number)[] = [...base, i];
      for (const ep of EVENT_PROPS) {
        const handler = node.props[ep];
        if (typeof handler === "function") {
          const fullPath: (string | number)[] = [...path, ep];
          // A registered-component binding is content-addressed so a cold
          // dispatch can re-mint the same id and re-resolve the handler.
          // Inline (`comp === ""`) and continuation bindings can never be
          // rehydrated (dispatch throws ActionExpiredError once `component` is
          // falsy), so they get a fresh random id. Content-addressing an inline
          // binding would collide two structurally identical posts in the same
          // conversation onto one id — the later would overwrite the earlier and
          // a click on the older message would run the newer message's handler.
          const id =
            continuation || comp === ""
              ? `ck:${globalThis.crypto.randomUUID()}`
              : mintId(comp, fullPath, props);
          this.hot.set(id, {
            handler: handler as ClickHandler,
            value: node.props.value,
            ...(continuation ? { continuation: true as const } : {}),
          });
          await this.store.put(
            id,
            {
              component: comp,
              props,
              path: fullPath,
              conversationKey: conv,
              boundArgs: isBound(handler) ? getBoundArgs(handler) : undefined,
              ...(continuation
                ? { continuation: { ...continuation, actionId: id } }
                : {}),
            },
            continuation ? this.retentionMs : undefined,
          );
          node.props[ep] = { id };
        }
      }
      const children = node.props.children;
      if (Array.isArray(children)) {
        await this.walk(
          children as ChannelNode[],
          [...path, "children"],
          comp,
          props,
          conv,
          continuation,
        );
      }
    }
  }

  /**
   * Run the click handler for `id` and return the clicked element's `value`
   * (so callers can resolve a HITL `awaitChoice` waiter even when the platform
   * couldn't carry the value in its callback payload). Returns `undefined` when
   * the element has no `value`.
   */
  async dispatch(id: string, ctx: InteractionContext): Promise<unknown> {
    let handler: ClickHandler | undefined;
    let value: unknown;
    const hot = this.hot.get(id);
    if (hot) {
      if (hot.continuation && !(await this.store.get(id))) {
        this.hot.delete(id);
        throw new ActionExpiredError(id);
      }
      handler = hot.handler;
      value = hot.value;
    } else {
      const snap = await this.store.get(id);
      if (!snap || !snap.component) throw new ActionExpiredError(id);
      const fn = this.components.get(snap.component);
      if (!fn) throw new ActionExpiredError(id);
      const tree = renderToIR(
        fn(snap.props as Record<string, unknown>) as Renderable,
      );
      handler = pluck(tree, snap.path);
      value = pluckValue(tree, snap.path);
      if (!handler) throw new ActionExpiredError(id);
    }
    await handler({ ...ctx, action: { ...ctx.action, id } });
    return value;
  }

  /** Read and validate one continuation capability without consuming it. */
  async getContinuation(
    id: string,
    expected: ActionContinuationBinding,
  ): Promise<ActionContinuationSnapshot> {
    const available = await this.store.get(id);
    if (!available?.continuation) throw new ActionExpiredError(id);
    assertContinuationBinding(available.continuation, id, expected);
    return available.continuation;
  }

  /** Validate and atomically consume one continuation capability. */
  async claimContinuation(
    id: string,
    expected: ActionContinuationBinding,
  ): Promise<ActionContinuationSnapshot> {
    await this.getContinuation(id, expected);

    const claimed = await this.store.consume(id);
    if (!claimed?.continuation) throw new ActionExpiredError(id);
    assertContinuationBinding(claimed.continuation, id, expected);
    this.hot.delete(id);
    return claimed.continuation;
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

/**
 * Report a registry-identity hazard once per process. These fire on a hot path
 * (every post), and a per-post log would bury the signal it exists to raise.
 */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
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
