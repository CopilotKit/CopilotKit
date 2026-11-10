import { randomUUID } from "node:crypto";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type {
  LinearApiClient,
  LinearSession,
  LinearSessionActivity,
} from "./client.js";
import type { LinearWebhookIssue, ReplyTarget } from "./types.js";

/** Default number of session messages replayed into the agent each turn. */
const DEFAULT_MAX_MESSAGES = 50;

export interface LinearConversationStoreOptions {
  /** Client that reads the session. Only `getSession` is used. */
  client: Pick<LinearApiClient, "getSession">;
  /**
   * Max session messages replayed into the agent each turn (default 50). The
   * newest messages are kept. The issue context message does not count.
   */
  maxMessages?: number;
}

/**
 * Conversation store for Linear. One conversation is one agent session.
 *
 * Each turn gets a fresh agent (`linear-<sessionId>-<uuid>` thread id) whose
 * messages are rebuilt from the session's activities: `prompt` becomes a user
 * message, `response` and `elicitation` become assistant messages, and
 * `thought`, `action`, and `error` are left out. When the session is on an
 * issue, one user message with the issue context comes first. The inbound
 * prompt is already a session activity, so `seedsInboundTurn` is true.
 *
 * The store keeps the running agent per session, so a `stop` signal can
 * abort it with {@link LinearConversationStore.abortSession}.
 *
 * @example
 * const store = new LinearConversationStore({ client });
 * const { agent, release } = await store.getOrCreate(key, target, makeAgent);
 */
export class LinearConversationStore implements ConversationStore {
  readonly seedsInboundTurn = true;
  private readonly client: Pick<LinearApiClient, "getSession">;
  private readonly maxMessages: number;
  private readonly liveAgents = new Map<string, AbstractAgent>();

  constructor(options: LinearConversationStoreOptions) {
    this.client = options.client;
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  async getOrCreate(
    _conversationKey: string,
    replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ) {
    const sessionId = replyTarget.agentSessionId;
    const session = await this.client.getSession(sessionId);
    const agent = makeAgent(`linear-${sessionId}-${randomUUID()}`);
    agent.setMessages(this.agentMessages(session));
    this.liveAgents.set(sessionId, agent);
    const agentSession: AgentSession = {
      agent,
      release: () => {
        if (this.liveAgents.get(sessionId) === agent) {
          this.liveAgents.delete(sessionId);
        }
      },
    };
    return agentSession;
  }

  /**
   * Abort the running agent of a session (the user sent the `stop` signal).
   * Aborts the agent's `abortController` when it has one, then calls
   * `abortRun()`.
   *
   * @param agentSessionId - The Linear agent session to stop.
   * @returns `true` when the session had a live agent, `false` otherwise.
   */
  abortSession(agentSessionId: string) {
    const agent = this.liveAgents.get(agentSessionId);
    if (!agent) return false;
    abortControllerOf(agent)?.abort();
    agent.abortRun();
    return true;
  }

  /**
   * Back `Thread.getMessages()` from the session's activities: user prompts
   * and the agent's responses and elicitations, oldest first.
   *
   * @param replyTarget - The session to read.
   */
  async getMessages(replyTarget: ReplyTarget) {
    const session = await this.client.getSession(replyTarget.agentSessionId);
    const turns = conversationTurns(session.activities);
    const messages: ThreadMessage[] = turns.map((turn) => ({
      text: turn.body,
      isBot: turn.role === "assistant",
      ts: turn.activity.createdAt,
    }));
    return messages;
  }

  private agentMessages(session: LinearSession) {
    const turns = conversationTurns(session.activities).slice(
      -this.maxMessages,
    );
    const messages: Message[] = turns.map((turn) => ({
      id: turn.activity.id,
      role: turn.role,
      content: turn.body,
    }));
    if (session.issue) messages.unshift(issueContextMessage(session.issue));
    return messages;
  }
}

/**
 * The activities that are conversation turns, with their role. A `prompt`
 * with the `stop` signal is a control signal, not a turn.
 */
function conversationTurns(activities: readonly LinearSessionActivity[]) {
  const turns: Array<{
    activity: LinearSessionActivity;
    role: "user" | "assistant";
    body: string;
  }> = [];
  for (const activity of activities) {
    const { content } = activity;
    switch (content.type) {
      case "prompt":
        if (activity.signal === "stop") break;
        turns.push({ activity, role: "user", body: content.body });
        break;
      case "response":
      case "elicitation":
        turns.push({ activity, role: "assistant", body: content.body });
        break;
      case "thought":
      case "action":
      case "error":
        break;
      default: {
        const unhandled: never = content;
        throw new Error(
          `[channels-linear] unhandled activity content: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  }
  return turns;
}

function issueContextMessage(issue: LinearWebhookIssue): Message {
  const lines = [
    `Linear issue ${issue.identifier}: ${issue.title}`,
    `URL: ${issue.url}`,
  ];
  if (issue.description) lines.push("", issue.description);
  return {
    id: `linear-issue-${issue.id}`,
    role: "user",
    content: lines.join("\n"),
  };
}

/** The agent's `abortController`, when it has one (for example `HttpAgent`). */
function abortControllerOf(agent: AbstractAgent) {
  if (!("abortController" in agent)) return undefined;
  const controller = agent.abortController;
  return controller instanceof AbortController ? controller : undefined;
}
