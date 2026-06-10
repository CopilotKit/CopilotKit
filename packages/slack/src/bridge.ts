import { App, LogLevel } from "@slack/bolt";
// `@slack/web-api` is CommonJS; under Node ESM a named import of
// `retryPolicies` fails ("does not provide an export named 'retryPolicies'"),
// so import the module's default (its `module.exports`) and read the
// preset off it. `RetryOptions` is type-only, so it's erased and safe to
// name-import.
import slackWebApi, { type RetryOptions } from "@slack/web-api";
import { HttpAgent } from "@ag-ui/client";
import { SanitizingHttpAgent } from "./sanitizing-http-agent.js";
import { createHash } from "node:crypto";
import { SlackConversationStore } from "./conversation-store.js";
import type { FileDeliveryConfig } from "./download-files.js";
import { attachSlackListener } from "./slack-listener.js";
import {
  clickToConversation,
  createTurnRunner,
  dispatchA2UIAction,
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
import type { ActivityMessageRenderer } from "./activity-message-renderer.js";

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
   * Rate-limit retry policy for the underlying Slack `WebClient`. Slack
   * `429`s are retried automatically, honoring each response's
   * `Retry-After` header. Defaults to `retryPolicies.fiveRetriesInFiveMinutes`
   * — override (e.g. with `retryPolicies.tenRetriesInAboutThirtyMinutes`)
   * for more aggressive backoff, or pass a custom `RetryOptions`.
   */
  retryConfig?: RetryOptions;
  /**
   * Inbound file handling. When a user uploads files, the bridge downloads
   * them and delivers them to the agent as multimodal content (images as
   * image parts, CSV/JSON/text decoded as text). Tune the caps here; all
   * fields default (8 MiB/file, 5 files, 200 KiB of text).
   */
  files?: FileDeliveryConfig;
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
   * whose `handler` posts a Block Kit message via `chat.postMessage`.
   * The Slack-side equivalent of React's `useComponent`.
   */
  components?: ReadonlyArray<SlackComponent>;
  /**
   * Human-in-the-loop components — interactive Block Kit messages whose
   * `handler` posts blocks and then waits for the user to click a
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
  /**
   * Renderers for AG-UI **activity messages** — the canonical primitive
   * for any structured non-text agent output (A2UI surfaces, open
   * generative UI, custom app-specific activity types, …). Each
   * renderer is matched against incoming
   * `ActivityMessage { role: "activity", activityType, content }` by
   * `activityType` (with `"*"` as wildcard) and, optionally, `agentId`.
   *
   * A2UI is one well-known `activityType`. Build a renderer with the
   * `createA2UIActivityRenderer({ catalog })` helper:
   *
   *     renderActivityMessages: [
   *       createA2UIActivityRenderer({ catalog: dashboardCatalog }),
   *       // ...custom app-specific activity renderers
   *     ]
   *
   * The Slack-side equivalent of React's
   * `<CopilotKit renderActivityMessages={[...]}>`.
   */
  renderActivityMessages?: ReadonlyArray<ActivityMessageRenderer<any>>;
}

export interface SlackBridge {
  readonly app: App;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Hash an arbitrary string into a stable UUIDv5-shaped string. Used to
 * map bridge-internal thread keys (`slack-<channel>-<scope>`) to the
 * UUID format LangGraph dev requires. Same input → same UUID, so the
 * agent's per-thread state survives bridge restarts.
 */
function deterministicUuid(input: string): string {
  const h = createHash("sha1")
    .update(`copilotkitnext.slack:${input}`)
    .digest("hex");
  // RFC 4122 v5 layout: version 5 in the high nibble of byte 7,
  // variant bits 10xx in the high two bits of byte 9.
  const v = (5).toString(16);
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-" +
    v +
    h.slice(13, 16) +
    "-" +
    variant +
    h.slice(18, 20) +
    "-" +
    h.slice(20, 32)
  );
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
    // Honor Slack's rate limits: the underlying `WebClient` automatically
    // retries `429`s, waiting for the duration in the `Retry-After` header
    // before each retry. Every Slack call the bridge makes (chat.update
    // during streaming, chat.postMessage, users.list, conversations.*)
    // goes through this client, so rate-limited calls back off and retry
    // instead of being dropped. `fiveRetriesInFiveMinutes` keeps an
    // interactive bot responsive rather than retrying for half an hour.
    clientOptions: {
      retryConfig:
        config.retryConfig ??
        slackWebApi.retryPolicies.fiveRetriesInFiveMinutes,
    },
  });

  // `AGENT_URL` is expected to point at a CopilotKit Runtime
  // `/agent/:agentId/run` endpoint — the runtime applies the full
  // middleware stack (A2UI, MCPApps, OpenGenerativeUI, …) server-side,
  // so the bridge just speaks raw AG-UI and trusts the runtime to
  // surface activity events.
  const makeAgent = (threadId: string): HttpAgent => {
    const a = new SanitizingHttpAgent({
      url: config.agentUrl,
      headers: config.agentHeaders,
    });
    // LangGraph dev requires thread IDs to be valid UUIDs. The
    // bridge's natural thread key (e.g. `slack-C0B49MEJ1HQ-channel`)
    // is human-readable but not a UUID. Hash it down to a stable
    // UUIDv5-shaped string so the same Slack conversation always maps
    // to the same LangGraph thread (preserves agent memory across
    // turns) without imposing a UUID-typed key on the bridge's own
    // internal model.
    a.threadId = deterministicUuid(threadId);
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
        botToken: config.slackBotToken,
        files: config.files,
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
        renderActivityMessages: config.renderActivityMessages,
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

          // A2UI button click: action_id is conventionally prefixed
          // `a2ui:` (set by the Button renderer in app/a2ui/renderers.ts).
          // Decoded payload matches `A2UIUserAction` because the
          // walker's encodeAction wrapped it that way — forward as
          // `forwardedProps.a2uiAction.userAction` and the
          // A2UIMiddleware on the agent side synthesizes the
          // tool-result message.
          if (
            a.action_id.startsWith("a2ui:") &&
            decoded !== undefined &&
            click.channel
          ) {
            const { conversation, replyTarget } = clickToConversation({
              channelId: click.channel,
              threadTs: b.container?.thread_ts ?? b.message?.thread_ts,
            });
            console.log(
              "[slack-bridge] a2ui click %s → dispatching userAction on %s",
              a.action_id,
              `${conversation.channelId}::${conversation.scope}`,
            );
            await dispatchA2UIAction({
              conversation,
              replyTarget,
              userAction: decoded as Record<string, unknown>,
              renderActivityMessages: config.renderActivityMessages ?? [],
              client,
              makeAgent,
            });
            continue;
          }

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
