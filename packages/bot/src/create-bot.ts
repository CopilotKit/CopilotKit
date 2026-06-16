import type {
  PlatformAdapter,
  IngressSink,
  IncomingTurn,
  InteractionEvent,
  IncomingCommand,
} from "./platform-adapter.js";
import { ActionRegistry, ActionExpiredError } from "./action-registry.js";
import { InMemoryActionStore, type ActionStore } from "./action-store.js";
import {
  toAgentToolDescriptors,
  parseToolArgs,
  type BotTool,
  type ContextEntry,
} from "./tools.js";
import {
  normalizeCommandName,
  toCommandSpec,
  type BotCommand,
  type CommandContext,
} from "./commands.js";
import { Thread, type ThreadDeps } from "./thread.js";
import type { AbstractAgent } from "@ag-ui/client";
import type { InteractionContext, IncomingMessage } from "@copilotkit/bot-ui";

export type BotHandler = (ctx: {
  thread: Thread;
  message: IncomingMessage;
}) => void | Promise<void>;

export interface CreateBotOptions {
  adapters: PlatformAdapter[];
  agent?: AbstractAgent | ((threadId: string) => AbstractAgent);
  actionStore?: ActionStore;
  tools?: BotTool[];
  context?: ContextEntry[];
  /** Slash commands. Forwarded to adapters that support them; ignored elsewhere. */
  commands?: BotCommand[];
}

export interface Bot {
  onMention(h: BotHandler): void;
  onMessage(h: BotHandler): void;
  /** Handle clicks on a specific action `id`. `ctx.action.value` is typed as `TValue`. */
  onInteraction<TValue = unknown>(
    id: string,
    h: (ctx: InteractionContext<TValue>) => void | Promise<void>,
  ): void;
  /**
   * Handle an agent interrupt (an `on_interrupt` custom event). `payload` is the
   * event's value; pass `TPayload` to type it, e.g.
   * `onInterrupt<{ question: string }>("ask", ...)`.
   */
  onInterrupt<TPayload = unknown>(
    eventName: string,
    h: (args: { payload: TPayload; thread: Thread }) => void | Promise<void>,
  ): void;
  /** Register a slash command (with optional typed options). */
  onCommand(command: BotCommand): void;
  /** Register a free-text slash command by name. */
  onCommand(
    name: string,
    handler: (ctx: CommandContext) => void | Promise<void>,
  ): void;
  tool(t: BotTool): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createBot(opts: CreateBotOptions): Bot {
  const registry = new ActionRegistry({
    store: opts.actionStore ?? new InMemoryActionStore(),
  });

  const agentFactory: (threadId: string) => AbstractAgent = (() => {
    const a = opts.agent;
    if (typeof a === "function")
      return a as (threadId: string) => AbstractAgent;
    if (a) return () => a;
    return () => {
      throw new Error(
        "createBot: no agent configured (pass `agent` to use runAgent)",
      );
    };
  })();

  const toolMap = new Map<string, BotTool>();
  for (const t of opts.tools ?? []) toolMap.set(t.name, t);
  const context = opts.context ?? [];

  const mentionHandlers: BotHandler[] = [];
  const messageHandlers: BotHandler[] = [];
  const interactionHandlers = new Map<
    string,
    (ctx: InteractionContext) => void | Promise<void>
  >();
  const interruptHandlers = new Map<
    string,
    (args: { payload: unknown; thread: Thread }) => void | Promise<void>
  >();
  const commandHandlers = new Map<string, BotCommand>();
  for (const c of opts.commands ?? [])
    commandHandlers.set(normalizeCommandName(c.name), c);
  const waiters = new Map<string, (value: unknown) => void>();

  // Recomputed on start() so tools added via bot.tool() before start are picked up.
  let toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);

  function makeThread(
    adapter: PlatformAdapter,
    replyTarget: unknown,
    conversationKey: string,
  ): Thread {
    const deps: ThreadDeps = {
      adapter,
      replyTarget,
      conversationKey,
      registry,
      agentFactory,
      tools: toolMap,
      toolDescriptors,
      context,
      registerWaiter: (k, r) => waiters.set(k, r),
      interruptHandlers,
    };
    return new Thread(deps);
  }

  function makeSink(adapter: PlatformAdapter): IngressSink {
    return {
      async onTurn(turn: IncomingTurn) {
        const thread = makeThread(
          adapter,
          turn.replyTarget,
          turn.conversationKey,
        );
        const message: IncomingMessage = {
          text: turn.userText,
          contentParts: turn.contentParts,
          user: turn.user ?? { id: "" },
          ref: { id: "" },
          platform: turn.platform,
        };
        // v1 routing: there is no turn `kind`, so prefer mention handlers; if
        // none are registered, fall back to message handlers. (The reference
        // example registers identical handlers on both, so this avoids
        // double-firing while still invoking whatever is registered.)
        const handlers =
          mentionHandlers.length > 0 ? mentionHandlers : messageHandlers;
        for (const h of handlers) await h({ thread, message });
      },
      async onInteraction(evt: InteractionEvent) {
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
        );
        const user = evt.user ?? { id: "" };
        const ctx: InteractionContext = {
          thread,
          message: {
            text: "",
            user,
            ref: evt.messageRef ?? { id: "" },
            platform: adapter.platform,
          },
          action: { id: evt.id, value: evt.value },
          values: {},
          user,
          platform: adapter.platform,
        };
        try {
          const explicit = interactionHandlers.get(evt.id);
          if (explicit) {
            await explicit(ctx);
          } else {
            await registry.dispatch(evt.id, ctx);
          }
        } catch (err) {
          // v1: swallow expired-action dispatches; surface anything else.
          if (!(err instanceof ActionExpiredError)) throw err;
        }
        // Resolve any HITL waiter awaiting a choice in this conversation.
        const w = waiters.get(evt.conversationKey);
        if (w) {
          waiters.delete(evt.conversationKey);
          w(evt.value);
        }
      },
      async onCommand(cmd: IncomingCommand) {
        const command = commandHandlers.get(normalizeCommandName(cmd.command));
        if (!command) return; // unregistered command → skip
        const thread = makeThread(
          adapter,
          cmd.replyTarget,
          cmd.conversationKey,
        );
        // Resolve typed options from any structured args the surface supplied
        // (e.g. Discord); text-only surfaces (Slack) leave `options` empty and
        // the handler reads `text`.
        let options: Record<string, unknown> = {};
        if (command.options && cmd.rawOptions) {
          const parsed = await parseToolArgs(command.options, cmd.rawOptions);
          if (parsed.ok) options = parsed.value;
        }
        const ctx: CommandContext<Record<string, unknown>> = {
          thread,
          command: normalizeCommandName(cmd.command),
          text: cmd.text,
          options,
          user: cmd.user,
          platform: cmd.platform,
        };
        await command.handler(ctx);
      },
    };
  }

  return {
    onMention(h) {
      mentionHandlers.push(h);
    },
    onMessage(h) {
      messageHandlers.push(h);
    },
    onInteraction<TValue = unknown>(
      id: string,
      h: (ctx: InteractionContext<TValue>) => void | Promise<void>,
    ) {
      interactionHandlers.set(
        id,
        h as (ctx: InteractionContext) => void | Promise<void>,
      );
    },
    onInterrupt<TPayload = unknown>(
      eventName: string,
      h: (args: { payload: TPayload; thread: Thread }) => void | Promise<void>,
    ) {
      interruptHandlers.set(
        eventName,
        h as (args: {
          payload: unknown;
          thread: Thread;
        }) => void | Promise<void>,
      );
    },
    onCommand(
      commandOrName: BotCommand | string,
      handler?: (ctx: CommandContext) => void | Promise<void>,
    ) {
      const command: BotCommand =
        typeof commandOrName === "string"
          ? { name: commandOrName, handler: handler as BotCommand["handler"] }
          : commandOrName;
      commandHandlers.set(normalizeCommandName(command.name), command);
    },
    tool(t) {
      toolMap.set(t.name, t);
    },
    async start() {
      toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);
      await Promise.all(opts.adapters.map((a) => a.start(makeSink(a))));
      // Hand declared commands to adapters that register them up front (e.g.
      // Discord); adapters without `registerCommands` are skipped.
      const commandSpecs = [...commandHandlers.values()].map(toCommandSpec);
      if (commandSpecs.length > 0) {
        await Promise.all(
          opts.adapters.map((a) => a.registerCommands?.(commandSpecs)),
        );
      }
    },
    async stop() {
      await Promise.all(opts.adapters.map((a) => a.stop()));
    },
  };
}
