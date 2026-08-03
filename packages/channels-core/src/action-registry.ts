import type {
  ChannelNode,
  ClickHandler,
  InteractionContext,
  ComponentFn,
  Renderable,
  MessageReactionHandler,
} from "@copilotkit/channels-ui";
import { isBound, getBoundArgs, renderToIR } from "@copilotkit/channels-ui";
import type { ChannelComponentRenderContext } from "./channel-component.js";
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
  private components = new Map<
    string,
    {
      render: (
        props: Record<string, unknown>,
        context: ChannelComponentRenderContext,
      ) => Renderable | Promise<Renderable>;
      requireKeys: boolean;
    }
  >();
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
      platform?: string;
    },
  ): Promise<void> {
    await this.store.put(reactionKey(messageId), {
      component: snap.component,
      props: snap.props,
      path: [],
      conversationKey: snap.conversationKey,
      platform: snap.platform,
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
    const registered = this.components.get(snap.component);
    if (!registered) return undefined;
    const root = renderToIR(
      await registered.render(snap.props as Record<string, unknown>, {
        platform: (snap.platform ??
          "slack") as ChannelComponentRenderContext["platform"],
        signal: new AbortController().signal,
      }),
    );
    return takeMessageReaction(root);
  }

  registerComponent(
    name: string,
    fn: (
      props: Record<string, unknown>,
      context: ChannelComponentRenderContext,
    ) => Renderable | Promise<Renderable>,
    options: { requireKeys?: boolean } = {},
  ): void {
    this.components.set(name, {
      render: fn,
      requireKeys: options.requireKeys ?? false,
    });
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
    if (isComponentElement(ui)) {
      const fn = ui.type;
      component = fn.name || "anonymous";
      props = (ui.props ?? {}) as Record<string, unknown>;
      this.registerComponent(
        component,
        (componentProps) => fn(componentProps) as Renderable,
      );
      root = await this.bindTree(
        component,
        props,
        conversationKey,
        continuation,
        {
          platform: renderContext.platform,
          signal: renderContext.signal,
        },
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
          const id = continuation
            ? `ck:${globalThis.crypto.randomUUID()}`
            : mintId(
                comp,
                locator ? [locator.key, locator.eventProp] : fullPath,
                props,
              );
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
              ...(locator ? { locator } : {}),
              platform,
              actionValue: node.props.value,
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
      const registered = this.components.get(snap.component);
      if (!registered) throw new ActionExpiredError(id);
      const tree = renderToIR(
        await registered.render(snap.props as Record<string, unknown>, {
          platform: (snap.platform ??
            ctx.platform) as ChannelComponentRenderContext["platform"],
          signal: new AbortController().signal,
        }),
      );
      handler = snap.locator
        ? findHandlerByLocator(tree, snap.locator)
        : pluck(tree, snap.path);
      value = snap.locator ? snap.actionValue : pluckValue(tree, snap.path);
      if (!handler) throw new ActionExpiredError(id);
    }
    const actionValue = value === undefined ? ctx.action.value : value;
    await handler({
      ...ctx,
      action: { ...ctx.action, id, value: actionValue },
    });
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
