import { App, LogLevel } from "@slack/bolt";
import { HttpAgent } from "@ag-ui/client";
import { SlackConversationStore } from "./conversation-store.js";
import { attachSlackListener } from "./slack-listener.js";
import {
  clickToConversation,
  createTurnRunner,
  recoverFromStaleClick,
} from "./turn-runner.js";
import type { FrontendTool, SlackContextEntry } from "./frontend-tools.js";
import {
  componentToFrontendTool,
  type SlackComponent,
} from "./slack-component.js";
import {
  HumanInTheLoopRegistry,
  hitlToFrontendTool,
  type HumanInTheLoop,
} from "./human-in-the-loop.js";
import type { InterruptHandler } from "./interrupt.js";

export interface SlackBridgeConfig {
  /** AG-UI agent HTTP endpoint (any AG-UI server: CopilotKit Runtime, LangGraph, custom). */
  agentUrl: string;
  /** Optional extra headers forwarded to the agent (e.g. auth). */
  agentHeaders?: Record<string, string>;
  /** Slack bot token (xoxb-...). */
  slackBotToken: string;
  /** Slack app-level token (xapp-...) used for Socket Mode. */
  slackAppToken: string;
  /** Optional signing secret; required when not using Socket Mode. */
  slackSigningSecret?: string;
  /** Use Socket Mode (default true). HTTP mode requires signingSecret. */
  socketMode?: boolean;
  /** Bolt log level. */
  logLevel?: LogLevel;
  /**
   * Frontend tools the agent can call against Slack. Apps typically
   * spread `defaultSlackTools` to get `lookup_slack_user`:
   *
   *     tools: [...defaultSlackTools, ...myAppTools]
   *
   * If you skip `defaultSlackTools`, the bot loses the ability to
   * resolve names to `<@USERID>` mentions — leave it out only if you
   * have an intentional reason to.
   */
  tools?: ReadonlyArray<FrontendTool>;
  /**
   * Readonly context entries forwarded as the AG-UI `context` field on
   * every `runAgent` call. Apps typically spread `defaultSlackContext`
   * to get tagging/mrkdwn/thread-model guidance:
   *
   *     context: [...defaultSlackContext, ...myAppContext]
   */
  context?: ReadonlyArray<SlackContextEntry>;
  /**
   * Agent-renderable components. Each one is sugar over a frontend tool
   * whose `execute` posts a Block Kit message via `chat.postMessage`.
   * The Slack-side equivalent of React's `useComponent`.
   */
  components?: ReadonlyArray<SlackComponent>;
  /**
   * Human-in-the-loop components — interactive Block Kit messages whose
   * `execute` posts blocks and then waits for the user to click a
   * button. The Slack-side equivalent of React's `useHumanInTheLoop`.
   * Clicks fire `block_actions` events which the bridge routes back to
   * the waiting tool call, so the agent run continues with the
   * structured action result as the tool output.
   */
  humanInTheLoopComponents?: ReadonlyArray<HumanInTheLoop>;
  /**
   * LangGraph-style `interrupt()` handlers. When the agent's graph
   * pauses at an `interrupt(payload)` call, the AG-UI runtime emits an
   * `on_interrupt` custom event; the bridge dispatches to a matching
   * handler, posts the rendered Block Kit picker, and resumes the
   * graph (via `forwardedProps.command.resume`) when the user clicks.
   * The Slack-side equivalent of React's `useInterrupt`.
   */
  interruptHandlers?: ReadonlyArray<InterruptHandler>;
  /**
   * Whether (and which) backend tool calls should surface as
   * `:wrench: Calling x…` → `:white_check_mark: x` status rows in the
   * thread. Default: `false` (no status rows). Set `true` to surface
   * every backend tool call, or pass a list of tool names to opt in
   * per-tool.
   *
   * Most bots want the default — the tool's output (a rendered
   * component / picker / streamed reply) is the user-visible affordance;
   * a tool-name status row is duplicate signal. Turn this on only when
   * a backend tool runs slowly enough that the user benefits from a
   * "we're working on it" affordance.
   */
  showToolStatus?: boolean | ReadonlyArray<string>;
}

export interface SlackBridge {
  readonly app: App;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Top-level factory. Wires:
 *
 *   Bolt App  →  slack-listener  →  turn-runner  →  HttpAgent
 *                                       │
 *                                       └→ event-renderer → ChunkedMessageStream → Slack
 *
 * State model: none. The bridge keeps no durable storage of its own —
 * Slack is the source of truth for conversation history, and the
 * SlackConversationStore translates Slack messages into AG-UI input on
 * every turn. Restarting the bridge is automatically safe; the next
 * user message rebuilds whatever the bridge needs.
 */
export function createSlackBridge(config: SlackBridgeConfig): SlackBridge {
  const socketMode = config.socketMode ?? true;

  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    signingSecret: config.slackSigningSecret,
    socketMode,
    logLevel: config.logLevel ?? LogLevel.INFO,
  });

  const makeAgent = (threadId: string): HttpAgent => {
    const a = new HttpAgent({
      url: config.agentUrl,
      headers: config.agentHeaders,
    });
    a.threadId = threadId;
    return a;
  };

  return {
    app,
    async start() {
      // Resolve our own bot user id *before* attaching the listener so the
      // loop guard (skip our own messages) is in place from the first event.
      let botUserId: string | undefined;
      try {
        const auth = await app.client.auth.test({
          token: config.slackBotToken,
        });
        botUserId = auth.user_id as string | undefined;
        console.log("[slack-bridge] bot user id:", botUserId);
      } catch (err) {
        console.warn(
          "[slack-bridge] auth.test failed; loop guard weaker:",
          err,
        );
      }
      if (!botUserId)
        throw new Error(
          "[slack-bridge] auth.test did not return a bot user id",
        );

      const componentTools = (config.components ?? []).map((c) =>
        componentToFrontendTool(c),
      );
      const hitlRegistry = new HumanInTheLoopRegistry();
      const hitlTools = (config.humanInTheLoopComponents ?? []).map((h) =>
        hitlToFrontendTool(h, hitlRegistry),
      );
      const allTools = [
        ...componentTools,
        ...hitlTools,
        ...(config.tools ?? []),
      ];
      const store = new SlackConversationStore({
        client: app.client,
        botUserId,
      });
      const runTurn = createTurnRunner({
        store,
        makeAgent,
        tools: allTools,
        context: config.context,
        botUserId,
        hitlRegistry,
        interruptHandlers: config.interruptHandlers,
        showToolStatus: config.showToolStatus,
      });
      attachSlackListener({ app, store, botUserId, onTurn: runTurn });

      // Route every block_actions click into the HITL registry. Bolt's
      // `app.action(/.*/, …)` matches every action_id; we delegate
      // dispatch to the registry which only resolves a wait if the
      // action_id was registered by an in-flight HITL tool.
      app.action(/.*/, async ({ ack, body, client }) => {
        await ack();
        const b = body as {
          actions?: Array<{ action_id?: string; value?: string }>;
          response_url?: string;
          container?: {
            message_ts?: string;
            channel_id?: string;
            thread_ts?: string;
          };
          channel?: { id?: string };
          message?: { ts?: string; thread_ts?: string };
          trigger_id?: string;
          user?: { id?: string };
        };
        const actions = b.actions ?? [];
        const click = {
          responseUrl: b.response_url,
          messageTs: b.container?.message_ts ?? b.message?.ts,
          channel: b.container?.channel_id ?? b.channel?.id,
          triggerId: b.trigger_id,
          userId: b.user?.id,
        };
        for (const a of actions) {
          if (!a.action_id) continue;
          // Decode the button's value (if any) — preferred over the
          // registry's stored value because it survives bridge restarts.
          let decoded: unknown;
          if (a.value) {
            try {
              decoded = JSON.parse(a.value);
            } catch {
              console.warn(
                "[slack-bridge] click %s carried a non-JSON value; ignoring",
                a.action_id,
              );
            }
          }
          const handled = hitlRegistry.handleAction(
            a.action_id,
            click,
            decoded,
          );
          if (handled) continue;
          // Stale click: no in-process pending wait (most often: bridge
          // restarted between picker-post and click). If we decoded a
          // resume value, try to resume the graph directly.
          if (decoded === undefined || !click.channel) continue;
          const { conversation, replyTarget } = clickToConversation({
            channelId: click.channel,
            threadTs: b.container?.thread_ts ?? b.message?.thread_ts,
          });
          console.log(
            "[slack-bridge] stale click %s → recovering via resume on %s",
            a.action_id,
            `${conversation.channelId}::${conversation.scope}`,
          );
          await recoverFromStaleClick({
            conversation,
            replyTarget,
            resumeValue: decoded,
            click: {
              responseUrl: click.responseUrl,
              messageTs: click.messageTs,
            },
            interruptHandlers: config.interruptHandlers ?? [],
            humanInTheLoopComponents: config.humanInTheLoopComponents ?? [],
            hitlRegistry,
            client,
            makeAgent,
            botUserId,
          });
        }
      });

      // Port only matters in HTTP mode; Bolt ignores it under socket mode.
      await app.start(Number(process.env.PORT ?? 3000));
      console.log("[slack-bridge] started (socketMode=%s)", socketMode);
    },
    async stop() {
      await app.stop();
    },
  };
}
