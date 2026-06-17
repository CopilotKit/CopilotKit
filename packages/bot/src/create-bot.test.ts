import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createBot } from "./create-bot.js";
import { defineBotCommand } from "./commands.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Section, Actions, Button } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Compile-time guards for the handler generics (validated by check-types/build,
 * never executed). `onInterrupt<T>` types `payload`; `onInteraction<T>` types
 * `ctx.action.value`.
 */
const __handlerTypeGuards = () => {
  const bot = createBot({ adapters: [new FakeAdapter()] });
  bot.onInterrupt<{ question: string }>("ask", ({ payload }) => {
    payload.question.toUpperCase();
    // @ts-expect-error 'missing' is not on the payload type
    payload.missing;
  });
  bot.onInteraction<{ page: number }>("next", (ctx) => {
    ctx.action.value?.page.toFixed(0);
    // @ts-expect-error 'nope' is not on the action value type
    ctx.action.value?.nope;
  });
};
void __handlerTypeGuards;

/** Recursively find the first node of a given type in an IR tree. */
function findNode(nodes: BotNode[], type: string): BotNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const children = n.props.children;
    if (Array.isArray(children)) {
      const found = findNode(children as BotNode[], type);
      if (found) return found;
    }
  }
  return undefined;
}

/** Concatenate all text node values in an IR tree. */
function collectText(nodes: BotNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text" && typeof n.props.value === "string")
      out += n.props.value;
    const children = n.props.children;
    if (Array.isArray(children)) out += collectText(children as BotNode[]);
  }
  return out;
}

describe("createBot", () => {
  it("routes a mention to a handler that posts UI", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    bot.onMention(async ({ thread }) => {
      await thread.post(Section({ children: "hi" }));
    });

    await bot.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    expect(fake.posted.length).toBe(1);
    const ir = fake.posted[0]!;
    expect(findNode(ir, "section")).toBeDefined();
    expect(collectText(ir)).toBe("hi");
  });

  it("dispatches a bound onClick handler on interaction", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let clicked = false;
    bot.onMention(async ({ thread }) => {
      await thread.post(
        Actions({
          children: [
            Button({
              value: { ok: 1 },
              onClick: () => {
                clicked = true;
              },
              children: "Go",
            }),
          ],
        }),
      );
    });

    await bot.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;
    expect(typeof id).toBe("string");

    fake.emitInteraction({ id, conversationKey: "c1", value: { ok: 1 } });
    await tick();

    expect(clicked).toBe(true);
  });

  it("merges per-turn runAgent context with the bot-level context", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    // Capture the context/tools passed to the agent's first runAgent call.
    let seenContext: unknown;
    let seenTools: unknown;
    const origRunAgent = agent.runAgent.bind(agent);
    agent.runAgent = async (parameters, subscriber) => {
      if (seenContext === undefined) {
        seenContext = (parameters as { context?: unknown } | undefined)
          ?.context;
        seenTools = (parameters as { tools?: unknown } | undefined)?.tools;
      }
      return origRunAgent(parameters, subscriber);
    };

    const bot = createBot({
      adapters: [fake],
      agent: () => agent,
      context: [{ description: "bot-level", value: "always here" }],
    });

    bot.onMention(async ({ thread }) => {
      await thread.runAgent({
        context: [{ description: "who", value: "user U1" }],
      });
    });

    await bot.start();
    fake.emitTurn({ userText: "go", conversationKey: "c1" });
    await tick();

    expect(seenContext).toEqual([
      { description: "bot-level", value: "always here" },
      { description: "who", value: "user U1" },
    ]);
    expect(seenTools).toEqual([]);
  });

  it("thread.postFile returns a capability-gated error when the adapter can't upload", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let result: { ok: boolean; error?: string } | undefined;
    bot.onMention(async ({ thread }) => {
      result = await thread.postFile({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "x.png",
      });
    });

    await bot.start();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();

    expect(result).toEqual({
      ok: false,
      error: "fake does not support file upload",
    });
  });

  it("thread.getMessages and thread.lookupUser surface the adapter's data", async () => {
    const fake = new FakeAdapter();
    fake.messages = [
      { user: { id: "u1", name: "Ada" }, text: "hi", ts: "1", isBot: false },
    ];
    fake.user = { id: "u1", name: "Ada" };
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let history: unknown;
    let resolved: unknown;
    bot.onMention(async ({ thread }) => {
      history = await thread.getMessages();
      resolved = await thread.lookupUser("Ada");
    });

    await bot.start();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();

    expect(history).toEqual([
      { user: { id: "u1", name: "Ada" }, text: "hi", ts: "1", isBot: false },
    ]);
    expect(resolved).toEqual({ id: "u1", name: "Ada" });
  });

  it("resolves awaitChoice when a matching interaction arrives", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let choicePromise: Promise<unknown> | undefined;
    bot.onMention(async ({ thread }) => {
      choicePromise = thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: { confirmed: true },
              onClick: () => {},
              children: "Confirm",
            }),
          ],
        }),
      );
    });

    await bot.start();
    fake.emitTurn({ userText: "decide", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;

    fake.emitInteraction({
      id,
      conversationKey: "c1",
      value: { confirmed: true },
    });
    await tick();

    expect(choicePromise).toBeDefined();
    await expect(choicePromise!).resolves.toEqual({ confirmed: true });
  });
});

describe("createBot slash commands", () => {
  it("routes a command to its handler with the raw text", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    let seen: { command: string; text: string } | undefined;
    bot.onCommand("triage", ({ command, text }) => {
      seen = { command, text };
    });
    await bot.start();
    await fake.emitCommand({ command: "/Triage", text: "db is down" });
    expect(seen).toEqual({ command: "triage", text: "db is down" });
  });

  it("ignores a command with no registered handler", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    let fired = false;
    bot.onCommand("triage", () => {
      fired = true;
    });
    await bot.start();
    await fake.emitCommand({ command: "unknown", text: "x" });
    expect(fired).toBe(false);
  });

  it("parses rawOptions through the command's schema into ctx.options", async () => {
    let captured: { seat: string } | undefined;
    const fake = new FakeAdapter();
    const bot = createBot({
      adapters: [fake],
      commands: [
        defineBotCommand({
          name: "book",
          options: z.object({ seat: z.string() }),
          handler: ({ options }) => {
            captured = options; // typed { seat: string }
          },
        }),
      ],
    });
    await bot.start();
    await fake.emitCommand({
      command: "book",
      text: "raw",
      rawOptions: { seat: "12A" },
    });
    expect(captured).toEqual({ seat: "12A" });
  });

  it("hands declared commands to adapters that implement registerCommands", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    bot.onCommand("triage", () => {});
    bot.onCommand("status", () => {});
    await bot.start();
    expect(fake.registeredCommands?.map((c) => c.name).sort()).toEqual([
      "status",
      "triage",
    ]);
  });
});
