import type {
  ActionActivityContent,
  AgentActivityContent,
  AgentActivitySignal,
  AuthSignalMetadata,
  LinearAdapterOptions,
  LinearWebhookIssue,
  PromptActivityContent,
  SelectSignalMetadata,
} from "./types.js";

const DEFAULT_API_URL = "https://api.linear.app/graphql";

/** Activities fetched per page when rebuilding a session's history. */
const ACTIVITY_PAGE_SIZE = 100;

/** Upper bound on activity pages per `getSession` call (1,000 activities). */
const MAX_ACTIVITY_PAGES = 10;

const ACTIVITY_CREATE_MUTATION = `
  mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity {
        id
      }
    }
  }
`;

const ACTIVITY_CONNECTION_FIELDS = `
  nodes {
    id
    createdAt
    signal
    user {
      id
    }
    content {
      ... on AgentActivityThoughtContent {
        type
        body
      }
      ... on AgentActivityActionContent {
        type
        action
        parameter
        result
      }
      ... on AgentActivityResponseContent {
        type
        body
      }
      ... on AgentActivityElicitationContent {
        type
        body
      }
      ... on AgentActivityErrorContent {
        type
        body
      }
      ... on AgentActivityPromptContent {
        type
        body
      }
    }
  }
  pageInfo {
    hasNextPage
    endCursor
  }
`;

const SESSION_QUERY = `
  query AgentSession($id: String!, $first: Int!) {
    agentSession(id: $id) {
      id
      issue {
        id
        identifier
        title
        description
        url
      }
      activities(first: $first) {
        ${ACTIVITY_CONNECTION_FIELDS}
      }
    }
  }
`;

const SESSION_ACTIVITIES_QUERY = `
  query AgentSessionActivities($id: String!, $first: Int!, $after: String!) {
    agentSession(id: $id) {
      activities(first: $first, after: $after) {
        ${ACTIVITY_CONNECTION_FIELDS}
      }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
      name
    }
  }
`;

/** One entry of a GraphQL `errors` array returned by Linear. */
export interface LinearGraphQLError {
  message: string;
  path?: ReadonlyArray<string | number>;
  /** Linear sets `code`, for example `"RATELIMITED"` or `"AUTHENTICATION_ERROR"`. */
  extensions?: { code?: string; [k: string]: unknown };
}

interface LinearApiErrorInit {
  status: number;
  errors: LinearGraphQLError[];
  retryAfterMs?: number;
}

/**
 * Thrown by every `LinearApiClient` method when Linear answers with a non-2xx
 * status, a GraphQL `errors` array, or a mutation with `success: false`.
 * The client never sleeps or retries; callers read `rateLimited` and
 * `retryAfterMs` to decide.
 */
export class LinearApiError extends Error {
  /** HTTP status of the response. Linear returns GraphQL errors with 200 or 400. */
  readonly status: number;
  /** GraphQL errors from the response body. Empty when the body had none. */
  readonly errors: LinearGraphQLError[];
  /** True on HTTP 429 or when an error has the `RATELIMITED` code. */
  readonly rateLimited: boolean;
  /**
   * Milliseconds until a retry is allowed, from `Retry-After` or, when rate
   * limited, from the `X-RateLimit-*-Reset` headers. Unset when no header
   * gives a time.
   */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, init: LinearApiErrorInit) {
    super(message);
    this.name = "LinearApiError";
    this.status = init.status;
    this.errors = init.errors;
    this.rateLimited = isRateLimited(init.status, init.errors);
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** Options for `LinearApiClient`. Same fields as on `LinearAdapterOptions`. */
export type LinearApiClientOptions = Pick<
  LinearAdapterOptions,
  "accessToken" | "apiUrl" | "fetch"
>;

/** Extra fields for `createActivity`. */
export interface CreateActivityOptions {
  /** The activity disappears after the next activity. Only for `thought` and `action`. */
  ephemeral?: boolean;
  /** `select` or `auth` on an `elicitation`. */
  signal?: AgentActivitySignal;
  /** Data for the signal: options for `select`, the link for `auth`. */
  signalMetadata?: SelectSignalMetadata | AuthSignalMetadata;
}

/** One activity of a session, as needed to rebuild the conversation. */
export interface LinearSessionActivity {
  id: string;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** The user who created the activity: the app user for agent activities, a human for prompts. */
  userId: string;
  /** `prompt` is a user message; `response` is an agent answer. */
  content: AgentActivityContent | PromptActivityContent;
  /** Set when the activity carries a signal, for example `stop` on a prompt. */
  signal?: AgentActivitySignal;
}

/** An agent session with its issue and activities, oldest activity first. */
export interface LinearSession {
  id: string;
  /** Unset for sessions that are not attached to an issue. */
  issue?: LinearWebhookIssue;
  activities: LinearSessionActivity[];
}

/** The app user the access token acts as. */
export interface LinearViewer {
  id: string;
  name: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: LinearGraphQLError[];
}

interface RawActivityContent {
  type: AgentActivityContent["type"] | "prompt";
  body?: string;
  action?: string;
  parameter?: string;
  result?: string | null;
}

interface RawActivity {
  id: string;
  createdAt: string;
  signal: AgentActivitySignal | null;
  user: { id: string };
  content: RawActivityContent;
}

interface RawActivityConnection {
  nodes: RawActivity[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
}

interface SessionData {
  agentSession: {
    id: string;
    issue: RawIssue | null;
    activities: RawActivityConnection;
  };
}

interface SessionActivitiesData {
  agentSession: { activities: RawActivityConnection };
}

interface ActivityCreateData {
  agentActivityCreate: { success: boolean; agentActivity: { id: string } };
}

interface ViewerData {
  viewer: LinearViewer;
}

/**
 * Thin client for Linear's GraphQL API, scoped to the Agent API calls the
 * adapter needs. Authenticates as the app actor with a Bearer token.
 *
 * Every method throws `LinearApiError` on an HTTP error, a GraphQL error, or
 * a failed mutation.
 *
 * @example
 * const client = new LinearApiClient({ accessToken: process.env.LINEAR_TOKEN! });
 * await client.createActivity(sessionId, { type: "thought", body: "Reading the issue" });
 */
export class LinearApiClient {
  private readonly accessToken: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LinearApiClientOptions) {
    this.accessToken = options.accessToken;
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /**
   * Post an agent activity to a session.
   *
   * @param agentSessionId - The session that receives the activity.
   * @param content - The activity content (`thought`, `action`, `response`, `elicitation`, `error`).
   * @param options - `ephemeral`, `signal`, and `signalMetadata`, passed to Linear as is.
   * @returns The id of the new activity.
   */
  async createActivity(
    agentSessionId: string,
    content: AgentActivityContent,
    options: CreateActivityOptions = {},
  ) {
    const data = await this.request<ActivityCreateData>(
      ACTIVITY_CREATE_MUTATION,
      { input: { agentSessionId, content, ...options } },
    );
    const payload = data.agentActivityCreate;
    if (!payload.success) {
      throw new LinearApiError(
        "Linear agentActivityCreate returned success: false",
        { status: 200, errors: [] },
      );
    }
    return { id: payload.agentActivity.id };
  }

  /**
   * Read a session, its issue, and its activities (oldest first). Reads at
   * most 1,000 activities.
   *
   * @param agentSessionId - The session to read.
   */
  async getSession(agentSessionId: string) {
    const first = await this.request<SessionData>(SESSION_QUERY, {
      id: agentSessionId,
      first: ACTIVITY_PAGE_SIZE,
    });
    const session = first.agentSession;
    const nodes = [...session.activities.nodes];
    let pageInfo = session.activities.pageInfo;
    let pages = 1;
    while (
      pageInfo.hasNextPage &&
      pageInfo.endCursor !== null &&
      pages < MAX_ACTIVITY_PAGES
    ) {
      const next = await this.request<SessionActivitiesData>(
        SESSION_ACTIVITIES_QUERY,
        {
          id: agentSessionId,
          first: ACTIVITY_PAGE_SIZE,
          after: pageInfo.endCursor,
        },
      );
      nodes.push(...next.agentSession.activities.nodes);
      pageInfo = next.agentSession.activities.pageInfo;
      pages += 1;
    }

    const activities = nodes
      .map(toSessionActivity)
      .filter((activity) => activity !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const result: LinearSession = { id: session.id, activities };
    if (session.issue !== null) result.issue = toIssue(session.issue);
    return result;
  }

  /** Read the app user the access token acts as. Use its id to spot the bot's own activities. */
  async getViewer() {
    const data = await this.request<ViewerData>(VIEWER_QUERY, {});
    return { id: data.viewer.id, name: data.viewer.name };
  }

  private async request<T>(query: string, variables: Record<string, unknown>) {
    const res = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = await readBody<T>(res);
    const errors = body?.errors ?? [];
    const data = body?.data;
    const failed = !res.ok || errors.length > 0;
    if (failed || data === undefined || data === null) {
      throw new LinearApiError(errorMessage(res, errors), {
        status: res.status,
        errors,
        retryAfterMs: retryAfterFromHeaders(
          res.headers,
          isRateLimited(res.status, errors),
        ),
      });
    }
    return data;
  }
}

async function readBody<T>(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    return undefined;
  }
}

function isRateLimited(status: number, errors: LinearGraphQLError[]) {
  return (
    status === 429 ||
    errors.some((error) => error.extensions?.code === "RATELIMITED")
  );
}

function errorMessage(res: Response, errors: LinearGraphQLError[]) {
  const detail = errors.map((error) => error.message).join("; ");
  const reason = detail || res.statusText || "no data in response";
  return `Linear API request failed: ${res.status} ${reason}`;
}

/**
 * `Retry-After` (seconds or HTTP date) wins. When rate limited without it,
 * use the latest `X-RateLimit-*-Reset` (epoch milliseconds).
 */
function retryAfterFromHeaders(headers: Headers, rateLimited: boolean) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  if (!rateLimited) return undefined;
  const resets = [
    headers.get("x-ratelimit-requests-reset"),
    headers.get("x-ratelimit-complexity-reset"),
  ]
    .map(Number)
    .filter((reset) => Number.isFinite(reset) && reset > 0);
  if (resets.length === 0) return undefined;
  return Math.max(0, Math.max(...resets) - Date.now());
}

function toIssue(raw: RawIssue) {
  const issue: LinearWebhookIssue = {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
  };
  if (raw.description !== null) issue.description = raw.description;
  return issue;
}

/** Returns null for a content type this client does not know, so a new Linear type cannot break history. */
function toSessionActivity(raw: RawActivity) {
  const content = toContent(raw.content);
  if (content === null) return null;
  const activity: LinearSessionActivity = {
    id: raw.id,
    createdAt: raw.createdAt,
    userId: raw.user.id,
    content,
  };
  if (raw.signal !== null) activity.signal = raw.signal;
  return activity;
}

function toContent(raw: RawActivityContent) {
  const body = raw.body ?? "";
  switch (raw.type) {
    case "action": {
      const content: ActionActivityContent = {
        type: "action",
        action: raw.action ?? "",
        parameter: raw.parameter ?? "",
      };
      if (typeof raw.result === "string") content.result = raw.result;
      return content;
    }
    case "thought":
    case "response":
    case "elicitation":
    case "error":
    case "prompt":
      return { type: raw.type, body };
    default:
      return null;
  }
}
