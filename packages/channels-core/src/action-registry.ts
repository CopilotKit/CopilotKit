import type {
  ChannelNode,
  ClickHandler,
  InteractionContext,
  ComponentFn,
  Renderable,
  MessageReactionHandler,
} from "@copilotkit/channels-ui";
import { isBound, getBoundArgs, renderToIR } from "@copilotkit/channels-ui";
import { mintId } from "./mint-id.js";
import type { ActionStore } from "./action-store.js";

export class ActionExpiredError extends Error {
  constructor(id: string) {
    super(`Action "${id}" has expired or is no longer available.`);
    this.name = "ActionExpiredError";
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
  private hot = new Map<string, { handler: ClickHandler; value: unknown }>();
  // Same-process fast path for `<Message onReaction>` handlers, keyed by the
  // posted message's id. Mirrors the `hot` action cache; the durable snapshot
  // (below) is the cross-restart counterpart, exactly like onClick.
  private messageReactions = new Map<string, MessageReactionHandler>();

  constructor(opts: { store: ActionStore }) {
    this.store = opts.store;
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

  registerComponent(name: string, fn: ComponentFn): void {
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
  ): Promise<ChannelNode[]> {
    const fn = this.components.get(componentName);
    const root = renderToIR((fn ? fn(props) : props) as Renderable);
    await this.walk(root, [], componentName, props, conversationKey);
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
      component = fn.name || "anonymous";
      props = (ui.props ?? {}) as Record<string, unknown>;
      this.registerComponent(component, fn);
      root = await this.bindTree(component, props, conversationKey);
    } else {
      root = renderToIR(ui);
      await this.walk(root, [], "", undefined, conversationKey);
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
  ): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const path: (string | number)[] = [...base, i];
      for (const ep of EVENT_PROPS) {
        const handler = node.props[ep];
        if (typeof handler === "function") {
          const fullPath: (string | number)[] = [...path, ep];
          const id = mintId(comp, fullPath, props);
          this.hot.set(id, {
            handler: handler as ClickHandler,
            value: node.props.value,
          });
          await this.store.put(id, {
            component: comp,
            props,
            path: fullPath,
            conversationKey: conv,
            boundArgs: isBound(handler) ? getBoundArgs(handler) : undefined,
          });
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
