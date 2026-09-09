import { createNativeNode } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  InteractionContext,
  Thread,
} from "@copilotkit/channels-ui";
import { expect, test, vi } from "vitest";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";

function SlackButton(props: {
  onClick: (context: InteractionContext) => void;
  text: string;
  value: { decision: string };
}) {
  return createNativeNode("slack", "element", "button", props);
}

async function unusedChoice<T>(): Promise<T> {
  throw new Error("awaitChoice is not used by this fixture");
}

async function emptyState<T>(): Promise<T | undefined> {
  return undefined;
}

function interactionContext(id: string): InteractionContext {
  const thread: Thread = {
    platform: "slack",
    post: async () => ({ id: "message-1" }),
    update: async (ref) => ref,
    delete: async () => undefined,
    awaitChoice: unusedChoice,
    runAgent: async () => undefined,
    resume: async () => undefined,
    stream: async () => ({ id: "message-1" }),
    postFile: async () => ({ ok: true, fileId: "file-1" }),
    getMessages: async () => [],
    lookupUser: async () => undefined,
    setSuggestedPrompts: async () => ({ ok: true }),
    setTitle: async () => ({ ok: true }),
    react: async () => ({ ok: true }),
    unreact: async () => ({ ok: true }),
    postEphemeral: async () => null,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
    isSubscribed: async () => false,
    setState: async () => undefined,
    state: emptyState,
  };
  const actor = { id: "user-1", kind: "human" as const };
  return {
    thread,
    message: {
      text: "",
      user: null,
      actor,
      ref: { id: "message-1" },
      platform: "slack",
    },
    action: { id, value: { decision: "provider-mutated" } },
    values: {},
    user: null,
    actor,
    platform: "slack",
  };
}

function actionId(tree: ChannelNode[], key: string): string {
  const elements = tree[0]?.props.elements;
  if (!Array.isArray(elements)) {
    throw new Error("expected native action elements");
  }
  const node = elements.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "key" in candidate &&
      candidate.key === key,
  );
  if (!node || typeof node !== "object" || !("props" in node)) {
    throw new Error(`expected action with key ${key}`);
  }
  const handler = (node as ChannelNode).props.onClick;
  if (
    typeof handler !== "object" ||
    handler === null ||
    !("id" in handler) ||
    typeof handler.id !== "string"
  ) {
    throw new Error(`expected bound action with key ${key}`);
  }
  return handler.id;
}

test("cold recovery finds the same keyed handler after async sibling reorder", async () => {
  const store = new InMemoryActionStore();
  const handled = vi.fn();
  let reordered = false;
  const render = async () => {
    await Promise.resolve();
    const approve = (
      <SlackButton
        key="approve-order"
        text="Approve"
        value={{ decision: reordered ? "changed" : "approve" }}
        onClick={(context) => handled("approve", context.action.value)}
      />
    );
    const reject = (
      <SlackButton
        key="reject-order"
        text="Reject"
        value={{ decision: "reject" }}
        onClick={(context) => handled("reject", context.action.value)}
      />
    );
    const unrelated = (
      <SlackButton
        key="inspect-order"
        text="Inspect"
        value={{ decision: "inspect" }}
        onClick={(context) => handled("inspect", context.action.value)}
      />
    );
    return createNativeNode("slack", "block", "actions", {
      elements: reordered ? [unrelated, reject, approve] : [approve, reject],
    });
  };
  const first = new ActionRegistry({ store });
  first.registerComponent("order_actions", render, { requireKeys: true });
  const tree = await first.bindTree(
    "order_actions",
    {},
    "conversation-1",
    undefined,
    { platform: "slack", signal: new AbortController().signal },
  );
  const id = actionId(tree, "approve-order");
  reordered = true;
  const restarted = new ActionRegistry({ store });
  restarted.registerComponent("order_actions", render, {
    requireKeys: true,
  });

  const value = await restarted.dispatch(id, interactionContext(id));

  expect(value).toEqual({ decision: "approve" });
  expect(handled).toHaveBeenCalledOnce();
  expect(handled).toHaveBeenCalledWith("approve", { decision: "approve" });
});

test("component tools reject a handler without a stable JSX key", async () => {
  const registry = new ActionRegistry({ store: new InMemoryActionStore() });
  registry.registerComponent(
    "missing_key",
    () =>
      createNativeNode("slack", "element", "button", {
        text: "Approve",
        onClick: () => undefined,
      }),
    { requireKeys: true },
  );

  await expect(
    registry.bindTree("missing_key", {}, "conversation-1"),
  ).rejects.toThrow("missing_key[0].onClick requires a non-empty JSX key");
});

test("component tools reject duplicate interactive keys", async () => {
  const registry = new ActionRegistry({ store: new InMemoryActionStore() });
  registry.registerComponent(
    "duplicate_key",
    () =>
      createNativeNode("slack", "block", "actions", {
        elements: [
          <SlackButton
            key="decision"
            text="Approve"
            value={{ decision: "approve" }}
            onClick={() => undefined}
          />,
          <SlackButton
            key="decision"
            text="Reject"
            value={{ decision: "reject" }}
            onClick={() => undefined}
          />,
        ],
      }),
    { requireKeys: true },
  );

  await expect(
    registry.bindTree("duplicate_key", {}, "conversation-1"),
  ).rejects.toThrow('duplicate interactive JSX key "decision"');
});
