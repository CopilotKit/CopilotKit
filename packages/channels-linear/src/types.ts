import type { StateStore } from "@copilotkit/channels-core";

/**
 * Where a reply goes: one Linear agent session. Every reply is an agent
 * activity posted to `agentSessionId`.
 */
export interface ReplyTarget {
  /** The Linear workspace (organization) id that owns the session. */
  organizationId: string;
  /** The agent session that receives the activity. */
  agentSessionId: string;
  /** The issue the session is attached to, when there is one. */
  issueId?: string;
}

/**
 * A ref to an agent activity the adapter posted. Linear activities are not
 * editable, so the ref only identifies the activity and its session.
 */
export interface LinearMessageRef {
  /** The agent activity id returned by `agentActivityCreate`. */
  id: string;
  /** The agent session the activity belongs to. */
  agentSessionId: string;
  [k: string]: unknown;
}

export interface LinearAdapterOptions {
  /**
   * OAuth access token for the app actor (the app installed with
   * `actor=app` and the `app:mentionable` + `app:assignable` scopes).
   * Sent as `Authorization: Bearer <token>` on every GraphQL call.
   */
  accessToken: string;
  /**
   * Webhook signing secret. Used to verify the `Linear-Signature` header
   * (hex HMAC-SHA256 of the raw body) on inbound POSTs.
   */
  webhookSecret: string;
  /**
   * Port for the built-in `node:http` webhook server. When unset, no server
   * starts and the host mounts `handleWebhook(request)` itself.
   */
  port?: number;
  /** Webhook path served by the built-in server (default "/webhook"). */
  path?: string;
  /** Linear GraphQL endpoint (default "https://api.linear.app/graphql"). Overridable for tests. */
  apiUrl?: string;
  /** `fetch` implementation used for GraphQL calls (default the global `fetch`). Overridable for tests. */
  fetch?: typeof fetch;
  /** Persistence for adapter state such as pending choices (default `MemoryStore`). */
  stateStore?: StateStore;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
}

/** Every agent activity content type Linear knows. Only `prompt` is user-created. */
export type AgentActivityType =
  | "thought"
  | "action"
  | "response"
  | "elicitation"
  | "error"
  | "prompt";

/** An internal note or reasoning step. Can be ephemeral. */
export interface ThoughtActivityContent {
  type: "thought";
  /** Markdown body. */
  body: string;
}

/** A tool call. Can be ephemeral. Post again with `result` when it finishes. */
export interface ActionActivityContent {
  type: "action";
  /** Verb-like label, for example "Searching" then "Searched". */
  action: string;
  /** What the action runs on, for example a query or a file path. */
  parameter: string;
  /** Markdown result, set once the action is done. */
  result?: string;
}

/** The final answer of a turn. */
export interface ResponseActivityContent {
  type: "response";
  /** Markdown body. */
  body: string;
}

/** A question to the user. Pair with the `select` or `auth` signal. */
export interface ElicitationActivityContent {
  type: "elicitation";
  /** Markdown body. */
  body: string;
}

/** A failure shown to the user. */
export interface ErrorActivityContent {
  type: "error";
  /** Markdown body. */
  body: string;
}

/** A user message in the session (the only user-created content type). */
export interface PromptActivityContent {
  type: "prompt";
  /** Markdown body. */
  body: string;
}

/** Content the agent can post with `agentActivityCreate`. */
export type AgentActivityContent =
  | ThoughtActivityContent
  | ActionActivityContent
  | ResponseActivityContent
  | ElicitationActivityContent
  | ErrorActivityContent;

/**
 * Activity signal (Linear enum `AgentActivitySignal`).
 * - `select`, `auth`: agent to user, only on `elicitation`.
 * - `stop`: user to agent, only on `prompt`. The agent must stop and post a
 *   final `response` or `error`.
 * - `continue`: in the schema enum, not described in the agent docs.
 */
export type AgentActivitySignal = "auth" | "continue" | "select" | "stop";

/** `signalMetadata` for an `elicitation` with the `select` signal. */
export interface SelectSignalMetadata {
  /** Options the user can pick. A pick comes back as a `prompt` activity. */
  options: Array<{ label?: string; value: string }>;
}

/** `signalMetadata` for an `elicitation` with the `auth` signal. */
export interface AuthSignalMetadata {
  /** Account-linking URL the user opens. */
  url: string;
  /** Restricts the link to one Linear user. */
  userId?: string;
  /** Display name of the external provider. */
  providerName?: string;
}

/** The user who created a session or an activity (webhook child payload). */
export interface LinearWebhookUser {
  id: string;
  name: string;
  email: string;
}

/** The issue a session is attached to (webhook child payload). */
export interface LinearWebhookIssue {
  id: string;
  /** Human key, for example "ENG-123". */
  identifier: string;
  title: string;
  description?: string;
  url: string;
}

/** The agent session object inside an `AgentSessionEvent` webhook. */
export interface LinearWebhookAgentSession {
  id: string;
  /** Unset for sessions that are not attached to an issue. */
  issue?: LinearWebhookIssue;
  /** Root comment of the thread the session is attached to. */
  comment?: { id: string; body: string };
  /** Human responsible for the session. Unset for automation or agent-started sessions. */
  creator?: LinearWebhookUser;
}

/** The activity inside a `prompted` webhook (the user's new message). */
export interface LinearWebhookAgentActivity {
  id: string;
  /**
   * Linear types this as a free JSON object. On `prompted` it is a `prompt`.
   * The adapter only reads `type` and `body`.
   */
  content: AgentActivityContent | PromptActivityContent;
  /** `stop` when the user asks the agent to stop. */
  signal?: AgentActivitySignal;
  /** Free JSON object. Shape depends on `signal`. */
  signalMetadata?: Record<string, unknown>;
}

/**
 * `AgentSessionEvent` webhook body (Linear schema
 * `AgentSessionEventWebhookPayload`). Only the fields the adapter reads.
 * - `created`: a user mentioned the agent or delegated an issue to it.
 * - `prompted`: a user sent a new message into an existing session.
 */
export interface AgentSessionEventWebhook {
  type: "AgentSessionEvent";
  action: "created" | "prompted";
  organizationId: string;
  /** ISO 8601 time the payload was created. */
  createdAt: string;
  /** Unix time in milliseconds when the webhook was sent. Used for the freshness check. */
  webhookTimestamp: number;
  agentSession: LinearWebhookAgentSession;
  /** The new user activity. Present on `prompted`. */
  agentActivity?: LinearWebhookAgentActivity;
  /** Formatted context (issue, comments, guidance). Present only on `created`. */
  promptContext?: string;
}
