import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CpkThreadInspector } from "../index.js";
import type {
  ThreadDebuggerMessage,
  ThreadDebuggerProvider,
} from "../index.js";

const messages: ThreadDebuggerMessage[] = [
  { id: "u1", role: "user", content: "Can I resume yesterday's cart?" },
  {
    id: "a1",
    role: "assistant",
    content: "I'll look up your saved cart.",
    toolCalls: [
      { id: "t1", name: "restore_cart", args: { cartId: "cart-42" } },
    ],
  },
  { id: "t1-result", role: "tool", toolCallId: "t1", content: '{"items":2}' },
  { id: "a2", role: "assistant", content: "Your two items are ready." },
];
const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll,
    );
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

async function settle(detail: CpkThreadInspector): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
    await detail.updateComplete;
  }
}

function mount(
  provider: ThreadDebuggerProvider,
  conversationView = true,
): CpkThreadInspector {
  const detail = new CpkThreadInspector();
  detail.threadId = "thread-one";
  detail.provider = provider;
  detail.conversationView = conversationView;
  document.body.append(detail);
  return detail;
}

function tab(detail: CpkThreadInspector, name: string): HTMLButtonElement {
  const result = Array.from(
    detail.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ).find((item) => item.textContent?.trim() === name);
  if (!result) throw new Error(`Missing tab ${name}`);
  return result;
}

function activePanel(detail: CpkThreadInspector): HTMLElement {
  return detail.shadowRoot!.querySelector<HTMLElement>(
    '[role="tabpanel"]:not([hidden])',
  )!;
}

test("conversation is opt-in and preserves diagnostic tabs and canonical order", async () => {
  const getMessages = vi.fn().mockResolvedValue(messages);
  const getEvents = vi.fn().mockResolvedValue([]);
  const detail = mount({ getMessages, getEvents });
  await settle(detail);
  expect(tab(detail, "Conversation").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(activePanel(detail).textContent).toContain("Read-only conversation");
  expect(
    Array.from(activePanel(detail).querySelectorAll("[data-message-id]")).map(
      (item) => item.getAttribute("data-message-id"),
    ),
  ).toEqual(["u1", "a1", "t1-result", "a2"]);
  expect(
    activePanel(detail).querySelector("textarea,input,[contenteditable=true]"),
  ).toBeNull();
  tab(detail, "Timeline").click();
  await settle(detail);
  tab(detail, "Conversation").click();
  await settle(detail);
  expect(getMessages).toHaveBeenCalledTimes(1);
  expect(getEvents).toHaveBeenCalledTimes(1);
  expect(tab(detail, "AG-UI Events")).toBeDefined();
  expect(tab(detail, "State")).toBeDefined();
  const unchanged = mount({ getMessages, getEvents }, false);
  await settle(unchanged);
  expect(tab(unchanged, "Messages").getAttribute("aria-selected")).toBe("true");
  expect(unchanged.shadowRoot!.textContent).not.toContain(
    "Read-only conversation",
  );
});

test("event-only providers explain unavailable messages and retain the timeline destination", async () => {
  const detail = mount({
    getEvents: async () => [
      { type: "RUN_STARTED", timestamp: 1, payload: { runId: "run-1" } },
    ],
  });
  await settle(detail);
  expect(activePanel(detail).textContent).toContain(
    "Conversation messages are unavailable",
  );
  expect(activePanel(detail).textContent).not.toContain("No messages yet");
  const button = Array.from(
    activePanel(detail).querySelectorAll<HTMLButtonElement>("button"),
  ).find((item) => item.textContent?.includes("Open timeline"))!;
  expect(button.textContent).toContain("Open timeline");
  button.click();
  await settle(detail);
  expect(tab(detail, "Timeline").getAttribute("aria-selected")).toBe("true");
  expect(activePanel(detail).textContent).toContain("Run started");
});

test("preserves rich, system and orphan tool payloads without claiming tool success", async () => {
  const richMessages = [
    ...messages.slice(0, 2),
    {
      id: "system",
      role: "system",
      content: "Only restore the current user's cart.",
    },
    {
      id: "orphan",
      role: "tool",
      toolCallId: "unknown",
      content: "Unavailable",
    },
    {
      id: "activity",
      role: "activity",
      activityType: "cart-preview",
      content: '{"items":[{"name":"Kite"}]}',
    },
    {
      id: "image",
      role: "user",
      content: [{ type: "image", url: "https://example.test/private.png" }],
    },
  ] as unknown as ThreadDebuggerMessage[];
  const detail = mount({ getMessages: async () => richMessages });
  await settle(detail);
  expect(
    activePanel(detail).querySelectorAll("[data-message-id]"),
  ).toHaveLength(richMessages.length);
  expect(activePanel(detail).textContent).toContain("cart-preview");
  expect(activePanel(detail).textContent).toContain("private.png");
  expect(activePanel(detail).textContent).not.toContain("DONE");
  expect(activePanel(detail).querySelector("img,iframe,script")).toBeNull();
  expect(
    activePanel(detail).querySelectorAll("details > summary").length,
  ).toBeGreaterThan(3);
});

test("recorded run errors remain visible beside a readable conversation", async () => {
  const detail = mount({
    getMessages: async () => messages,
    getEvents: async () => [
      {
        type: "RUN_ERROR",
        timestamp: 1,
        payload: { message: "Cart restore timed out" },
      },
    ],
  });
  await settle(detail);
  expect(activePanel(detail).textContent).toContain("Cart restore timed out");
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
});

test("non-JSON tool arguments preserve readable values and the rest of the conversation", async () => {
  const shared = { cartId: "cart-42" };
  const args: Record<string, unknown> = {
    count: 9007199254740993n,
    first: shared,
    second: shared,
    missing: undefined,
    callback: () => undefined,
    token: Symbol("record"),
    duration: Infinity,
  };
  args.self = args;
  const detail = mount({
    getMessages: async () => [
      {
        id: "unusual-tool",
        role: "assistant",
        content: "Restoring your cart.",
        toolCalls: [{ id: "unusual-call", name: "restore_cart", args }],
      },
      ...messages.slice(3),
    ],
  });
  await settle(detail);
  const record = activePanel(detail).querySelector(
    '[data-message-id="unusual-tool"]',
  )!;
  const argumentsText = record.querySelector("details pre")!.textContent!;
  expect(argumentsText).toContain("[BigInt: 9007199254740993]");
  expect(argumentsText).toContain("[Circular reference]");
  expect(argumentsText.match(/cart-42/g)).toHaveLength(2);
  expect(argumentsText).toContain("[Undefined value]");
  expect(argumentsText).toContain("[Function value]");
  expect(argumentsText).toContain("[Symbol value: Symbol(record)]");
  expect(argumentsText).toContain("[Non-finite number: Infinity]");
  expect(
    record.querySelector(".cpk-conversation-disclosure--raw")!.textContent,
  ).toContain("[BigInt: 9007199254740993]");
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
});

test("an unserializable payload is labeled explicitly without breaking other messages", async () => {
  const args = Object.defineProperty({ cartId: "cart-42" }, "unreadable", {
    enumerable: true,
    get() {
      throw new Error("Unreadable provider value");
    },
  });
  const detail = mount({
    getMessages: async () => [
      {
        id: "unreadable-tool",
        role: "assistant",
        content: "Restoring your cart.",
        toolCalls: [{ id: "unreadable-call", name: "restore_cart", args }],
      },
      ...messages.slice(3),
    ],
  });
  await settle(detail);
  expect(activePanel(detail).textContent).toContain(
    "[Unable to display this recorded value as JSON]",
  );
  expect(activePanel(detail).textContent).toContain("Restoring your cart.");
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
});

test("loading and fetch errors do not pretend the conversation is empty", async () => {
  let reject!: (reason: Error) => void;
  const detail = mount({
    getMessages: () =>
      new Promise((_, failure) => {
        reject = failure;
      }),
  });
  await settle(detail);
  expect(activePanel(detail).textContent).toContain("Loading messages");
  reject(new Error("Connection interrupted"));
  await settle(detail);
  expect(activePanel(detail).textContent).toContain(
    "Could not load conversation messages: Connection interrupted",
  );
  expect(activePanel(detail).textContent).not.toContain("No messages captured");
});

test("aborted provider results and errors cannot overwrite a new source for the same thread", async () => {
  let reject!: (reason: Error) => void;
  let signal!: AbortSignal;
  const detail = mount({
    getMessages: (_threadId, options) => {
      signal = options.signal;
      return new Promise((_, failure) => {
        reject = failure;
      });
    },
  });
  await settle(detail);
  detail.provider = { getMessages: async () => messages };
  await settle(detail);
  expect(signal.aborted).toBe(true);
  reject(new Error("Old provider error"));
  await settle(detail);
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
  expect(activePanel(detail).textContent).not.toContain("Old provider error");
});

test("a successful live refresh supersedes initial loading and clears prior errors", async () => {
  const getMessages = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue(messages);
  const detail = mount({ getMessages });
  await settle(detail);
  detail.liveMessageVersion = 1;
  await settle(detail);
  expect(activePanel(detail).textContent).not.toContain("Loading messages");
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
  getMessages.mockRejectedValueOnce(new Error("Network failure"));
  detail.liveMessageVersion = 2;
  await settle(detail);
  expect(activePanel(detail).textContent).toContain(
    "Could not refresh messages",
  );
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
  detail.liveMessageVersion = 3;
  await settle(detail);
  expect(activePanel(detail).textContent).not.toContain(
    "Could not refresh messages",
  );
});

test("thread changes clear the old messages and reset the initial view", async () => {
  const getMessages = vi
    .fn()
    .mockResolvedValueOnce(messages)
    .mockImplementationOnce(() => new Promise(() => {}));
  const detail = mount({ getMessages });
  await settle(detail);
  tab(detail, "State").click();
  await settle(detail);
  detail.threadId = "thread-two";
  await settle(detail);
  expect(tab(detail, "Conversation").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(detail.shadowRoot!.textContent).not.toContain(
    "Your two items are ready.",
  );
  expect(activePanel(detail).textContent).toContain("Loading messages");
});

test("focus requests select and scroll a visible canonical message instead of its hidden timeline duplicate", async () => {
  const scroll = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const detail = mount({
    getMessages: async () => messages,
    getEvents: async () => [],
  });
  await settle(detail);
  tab(detail, "Timeline").click();
  await settle(detail);
  detail.focusMessageId = "a2";
  detail.focusRequestId = 1;
  await settle(detail);
  expect(tab(detail, "Conversation").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(scroll).toHaveBeenCalled();
  const node = scroll.mock.contexts.at(-1) as HTMLElement;
  expect(node.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(false);
  expect(node.getAttribute("data-message-id")).toBe("a2");
});

test("changing the opt-in switches views without dropping records or refetching", async () => {
  const getMessages = vi.fn().mockResolvedValue(messages);
  const detail = mount({ getMessages });
  await settle(detail);
  tab(detail, "State").click();
  await settle(detail);
  detail.conversationView = false;
  await settle(detail);
  expect(tab(detail, "Messages").getAttribute("aria-selected")).toBe("true");
  expect(
    detail.shadowRoot!.querySelector('[role="tab"]')?.textContent?.trim(),
  ).toBe("Messages");
  detail.conversationView = true;
  await settle(detail);
  expect(tab(detail, "Conversation").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(activePanel(detail).textContent).toContain(
    "Your two items are ready.",
  );
  expect(getMessages).toHaveBeenCalledTimes(1);
});

test("a canceled event request cannot attach the old provider's failure to the conversation", async () => {
  let rejectEvents!: (error: Error) => void;
  const detail = mount({
    getMessages: async () => messages,
    getEvents: () =>
      new Promise((_resolve, reject) => {
        rejectEvents = reject;
      }),
  });
  await settle(detail);
  detail.provider = {
    getMessages: async () => messages,
    getEvents: async () => [],
  };
  await settle(detail);
  rejectEvents(new Error("Previous organization history failed"));
  await settle(detail);
  expect(activePanel(detail).textContent).not.toContain(
    "Previous organization history failed",
  );
});
