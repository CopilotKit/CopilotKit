import { logger } from "@copilotkit/shared";
import type { BaseEvent } from "@ag-ui/client";

/**
 * Error thrown when an Intelligence platform HTTP request returns a non-2xx
 * status. Carries the HTTP {@link status} code so callers can branch on
 * specific failures (e.g. 404 for "not found", 409 for "conflict") without
 * parsing the error message string.
 *
 * @example
 * ```ts
 * try {
 *   await intelligence.getThread({ threadId });
 * } catch (error) {
 *   if (error instanceof PlatformRequestError && error.status === 404) {
 *     // thread does not exist yet
 *   }
 * }
 * ```
 */
export class PlatformRequestError extends Error {
  constructor(
    message: string,
    /** The HTTP status code returned by the platform (e.g. 404, 409, 500). */
    public readonly status: number,
  ) {
    super(message);
    this.name = "PlatformRequestError";
  }
}

/**
 * Client for the CopilotKit Intelligence Platform REST API.
 *
 * Construct the client once and pass it to any consumers that need it
 * (e.g. `CopilotRuntime`, `IntelligenceAgentRunner`):
 *
 * ```ts
 * import { CopilotKitIntelligence, CopilotRuntime } from "@copilotkit/runtime";
 *
 * const intelligence = new CopilotKitIntelligence({
 *   apiUrl: "https://api.copilotkit.ai",
 *   wsUrl: "wss://api.copilotkit.ai",
 *   apiKey: process.env.COPILOTKIT_API_KEY!,
 *   organizationId: process.env.COPILOTKIT_ORGANIZATION_ID!,
 * });
 *
 * const runtime = new CopilotRuntime({
 *   agents,
 *   intelligence,
 * });
 * ```
 */

/** Payload passed to `onThreadDeleted` listeners. */
export interface ThreadDeletedPayload {
  threadId: string;
  userId: string;
  agentId: string;
}

export interface CopilotKitIntelligenceConfig {
  /** Base URL of the intelligence platform API, e.g. "https://api.copilotkit.ai" */
  apiUrl: string;
  /** Intelligence websocket base URL. Runner and client socket URLs are derived from this. */
  wsUrl: string;
  /** API key for authenticating with the intelligence platform */
  apiKey: string;
  /** Organization identifier used for self-hosted Intelligence instances */
  organizationId: string;
  /**
   * Initial listener invoked after a thread is created.
   * Prefer {@link CopilotKitIntelligence.onThreadCreated} for multiple listeners.
   */
  onThreadCreated?: (thread: ThreadSummary) => void;
  /**
   * Initial listener invoked after a thread is updated.
   * Prefer {@link CopilotKitIntelligence.onThreadUpdated} for multiple listeners.
   */
  onThreadUpdated?: (thread: ThreadSummary) => void;
  /**
   * Initial listener invoked after a thread is deleted.
   * Prefer {@link CopilotKitIntelligence.onThreadDeleted} for multiple listeners.
   */
  onThreadDeleted?: (params: ThreadDeletedPayload) => void;
}

/**
 * Summary metadata for a single thread returned by the platform.
 *
 * This is the shape returned by list, get, create, and update operations.
 * It does not include the thread's message history — use
 * {@link CopilotKitIntelligence.getThreadMessages} for that.
 */
export interface ThreadSummary {
  /** Platform-assigned unique identifier. */
  id: string;
  /** Human-readable display name, or `null` if the thread has not been named. */
  name: string | null;
  /** ISO-8601 timestamp of the most recent agent run on this thread. */
  lastRunAt?: string;
  /** ISO-8601 timestamp of the most recent metadata update. */
  lastUpdatedAt?: string;
  /** ISO-8601 timestamp when the thread was created. */
  createdAt?: string;
  /** ISO-8601 timestamp when the thread was last updated. */
  updatedAt?: string;
  /** Whether the thread has been archived. Archived threads are excluded from default list results. */
  archived?: boolean;
  /** The agent that owns this thread. */
  agentId?: string;
  /** The user who created this thread. */
  createdById?: string;
  /** The organization this thread belongs to. */
  organizationId?: string;
}

/** Response from listing threads for a user/agent pair. */
export interface ListThreadsResponse {
  /** The matching threads, sorted by the platform's default ordering. */
  threads: ThreadSummary[];
  /** Join code for subscribing to realtime metadata updates for these threads. */
  joinCode: string;
  /** Short-lived token for authenticating the realtime subscription. */
  joinToken?: string;
  /** Opaque cursor for fetching the next page. `null` or absent when there are no more pages. */
  nextCursor?: string | null;
}

/**
 * Fields that can be updated on a thread via {@link CopilotKitIntelligence.updateThread}.
 *
 * Additional platform-specific fields can be passed as extra keys and will be
 * forwarded to the PATCH request body.
 */
export interface UpdateThreadRequest {
  /** New human-readable display name for the thread. */
  name?: string;
  [key: string]: unknown;
}

/** Parameters for creating a new thread via {@link CopilotKitIntelligence.createThread}. */
export interface CreateThreadRequest {
  /** Client-generated unique identifier for the new thread. */
  threadId: string;
  /** The user creating the thread. Used for authorization and scoping. */
  userId: string;
  /** The agent this thread belongs to. */
  agentId: string;
  /** Optional initial display name. If omitted, the thread is unnamed until explicitly renamed. */
  name?: string;
}

/** Credentials returned when locking or joining a thread's realtime channel. */
export interface ThreadConnectionResponse {
  /** Short-lived token for authenticating the Phoenix channel join. */
  joinToken: string;
  /** Optional join code that can be shared with other clients to join the same channel. */
  joinCode?: string;
  /** Lock metadata echoed back by the platform. */
  lock?: ThreadLockInfo;
}

export interface SubscribeToThreadsRequest {
  userId: string;
}

export interface SubscribeToThreadsResponse {
  joinToken: string;
}

export interface ConnectThreadBootstrapResponse {
  mode: "bootstrap";
  latestEventId: string | null;
  events: BaseEvent[];
}

export interface ConnectThreadLiveResponse {
  mode: "live";
  joinToken: string;
  joinFromEventId: string | null;
  events: BaseEvent[];
}

export type ConnectThreadResponse =
  | ConnectThreadBootstrapResponse
  | ConnectThreadLiveResponse
  | null;

/** A single message within a thread's persisted history. */
export interface ThreadMessage {
  /** Unique identifier for this message. */
  id: string;
  /** Message role, e.g. `"user"`, `"assistant"`, `"tool"`. */
  role: string;
  /** Text content of the message. May be absent for tool-call-only messages. */
  content?: string;
  /** Tool calls initiated by this message (assistant role only). */
  toolCalls?: Array<{
    id: string;
    name: string;
    /** JSON-encoded arguments passed to the tool. */
    args: string;
  }>;
  /** For tool-result messages, the ID of the tool call this message responds to. */
  toolCallId?: string;
}

/** Response from {@link CopilotKitIntelligence.getThreadMessages}. */
export interface ThreadMessagesResponse {
  messages: ThreadMessage[];
}

export interface AcquireThreadLockRequest {
  threadId: string;
  runId: string;
  userId: string;
  /** Custom Redis key prefix for the lock (default: "thread"). */
  lockKeyPrefix?: string;
  /** Lock TTL in seconds. When set, the lock auto-expires after this duration. */
  ttlSeconds?: number;
}

export interface RenewThreadLockRequest {
  threadId: string;
  runId: string;
  /** New TTL to set on the lock in seconds. */
  ttlSeconds: number;
  /** Must match the prefix used when acquiring. */
  lockKeyPrefix?: string;
}

export interface RenewThreadLockResponse {
  ttlSeconds: number;
}

export interface ThreadLockInfo {
  key: string;
  ttlSeconds: number | null;
}

interface ThreadEnvelope {
  thread: ThreadSummary;
}

export class CopilotKitIntelligence {
  #apiUrl: string;
  #runnerWsUrl: string;
  #clientWsUrl: string;
  #apiKey: string;
  #organizationId: string;
  #threadCreatedListeners = new Set<(thread: ThreadSummary) => void>();
  #threadUpdatedListeners = new Set<(thread: ThreadSummary) => void>();
  #threadDeletedListeners = new Set<(params: ThreadDeletedPayload) => void>();

  constructor(config: CopilotKitIntelligenceConfig) {
    const intelligenceWsUrl = normalizeIntelligenceWsUrl(config.wsUrl);

    this.#apiUrl = config.apiUrl.replace(/\/$/, "");
    this.#runnerWsUrl = deriveRunnerWsUrl(intelligenceWsUrl);
    this.#clientWsUrl = deriveClientWsUrl(intelligenceWsUrl);
    this.#apiKey = config.apiKey;
    this.#organizationId = config.organizationId;

    if (config.onThreadCreated) {
      this.onThreadCreated(config.onThreadCreated);
    }
    if (config.onThreadUpdated) {
      this.onThreadUpdated(config.onThreadUpdated);
    }
    if (config.onThreadDeleted) {
      this.onThreadDeleted(config.onThreadDeleted);
    }
  }

  /**
   * Register a listener invoked whenever a thread is created.
   *
   * Multiple listeners can be registered. Each call returns an unsubscribe
   * function that removes the listener when called.
   *
   * @param callback - Receives the newly created {@link ThreadSummary}.
   * @returns A function that removes this listener when called.
   *
   * @example
   * ```ts
   * const unsubscribe = intelligence.onThreadCreated((thread) => {
   *   console.log("Thread created:", thread.id);
   * });
   * // later…
   * unsubscribe();
   * ```
   */
  onThreadCreated(callback: (thread: ThreadSummary) => void): () => void {
    this.#threadCreatedListeners.add(callback);
    return () => {
      this.#threadCreatedListeners.delete(callback);
    };
  }

  /**
   * Register a listener invoked whenever a thread is updated (including archive).
   *
   * Multiple listeners can be registered. Each call returns an unsubscribe
   * function that removes the listener when called.
   *
   * @param callback - Receives the updated {@link ThreadSummary}.
   * @returns A function that removes this listener when called.
   */
  onThreadUpdated(callback: (thread: ThreadSummary) => void): () => void {
    this.#threadUpdatedListeners.add(callback);
    return () => {
      this.#threadUpdatedListeners.delete(callback);
    };
  }

  /**
   * Register a listener invoked whenever a thread is deleted.
   *
   * Multiple listeners can be registered. Each call returns an unsubscribe
   * function that removes the listener when called.
   *
   * @param callback - Receives the {@link ThreadDeletedPayload} identifying
   *   the deleted thread.
   * @returns A function that removes this listener when called.
   */
  onThreadDeleted(
    callback: (params: ThreadDeletedPayload) => void,
  ): () => void {
    this.#threadDeletedListeners.add(callback);
    return () => {
      this.#threadDeletedListeners.delete(callback);
    };
  }

  ɵgetApiUrl(): string {
    return this.#apiUrl;
  }

  ɵgetRunnerWsUrl(): string {
    return this.#runnerWsUrl;
  }

  ɵgetClientWsUrl(): string {
    return this.#clientWsUrl;
  }

  ɵgetOrganizationId(): string {
    return this.#organizationId;
  }

  ɵgetRunnerAuthToken(): string {
    return this.#apiKey;
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.#apiUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
      "X-Organization-Id": this.#organizationId,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body: text, path },
        "Intelligence platform request failed",
      );
      throw new PlatformRequestError(
        `Intelligence platform error ${response.status}: ${text || response.statusText}`,
        response.status,
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  #invokeLifecycleCallback(
    callbackName: "onThreadCreated" | "onThreadUpdated" | "onThreadDeleted",
    payload: ThreadSummary | ThreadDeletedPayload,
  ): void {
    const listeners =
      callbackName === "onThreadCreated"
        ? this.#threadCreatedListeners
        : callbackName === "onThreadUpdated"
          ? this.#threadUpdatedListeners
          : this.#threadDeletedListeners;

    for (const callback of listeners) {
      try {
        void (callback as (p: typeof payload) => void)(payload);
      } catch (error) {
        logger.error(
          { err: error, callbackName, payload },
          "Intelligence lifecycle callback failed",
        );
      }
    }
  }

  /**
   * List all non-archived threads for a given user and agent.
   *
   * @param params.userId - User whose threads to list.
   * @param params.agentId - Agent whose threads to list.
   * @returns The thread list along with realtime subscription credentials.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async listThreads(params: {
    userId: string;
    agentId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<ListThreadsResponse> {
    const query: Record<string, string> = {
      userId: params.userId,
      agentId: params.agentId,
    };
    if (params.includeArchived) query.includeArchived = "true";
    if (params.limit != null) query.limit = String(params.limit);
    if (params.cursor) query.cursor = params.cursor;

    const qs = new URLSearchParams(query).toString();
    return this.#request<ListThreadsResponse>("GET", `/api/threads?${qs}`);
  }

  async ɵsubscribeToThreads(
    params: SubscribeToThreadsRequest,
  ): Promise<SubscribeToThreadsResponse> {
    return this.#request<SubscribeToThreadsResponse>(
      "POST",
      "/api/threads/subscribe",
      {
        userId: params.userId,
      },
    );
  }

  /**
   * Update thread metadata (e.g. name).
   *
   * Triggers the `onThreadUpdated` lifecycle callback on success.
   *
   * @returns The updated thread summary.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async updateThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
    updates: UpdateThreadRequest;
  }): Promise<ThreadSummary> {
    const response = await this.#request<ThreadEnvelope>(
      "PATCH",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
      {
        userId: params.userId,
        agentId: params.agentId,
        ...params.updates,
      },
    );
    this.#invokeLifecycleCallback("onThreadUpdated", response.thread);
    return response.thread;
  }

  /**
   * Create a new thread on the platform.
   *
   * Triggers the `onThreadCreated` lifecycle callback on success.
   *
   * @returns The newly created thread summary.
   * @throws {@link PlatformRequestError} with status 409 if a thread with the
   *   same `threadId` already exists.
   */
  async createThread(params: CreateThreadRequest): Promise<ThreadSummary> {
    const response = await this.#request<ThreadEnvelope>(
      "POST",
      `/api/threads`,
      {
        threadId: params.threadId,
        userId: params.userId,
        agentId: params.agentId,
        ...(params.name !== undefined ? { name: params.name } : {}),
      },
    );
    this.#invokeLifecycleCallback("onThreadCreated", response.thread);
    return response.thread;
  }

  /**
   * Fetch a single thread by ID.
   *
   * @returns The thread summary.
   * @throws {@link PlatformRequestError} with status 404 if the thread does
   *   not exist.
   */
  async getThread(params: { threadId: string }): Promise<ThreadSummary> {
    const response = await this.#request<ThreadEnvelope>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
    );
    return response.thread;
  }

  /**
   * Get an existing thread or create it if it does not exist.
   *
   * Handles the race where a concurrent request creates the thread between
   * the initial 404 and the subsequent `createThread` call by catching the
   * 409 Conflict and retrying the get.
   *
   * Triggers the `onThreadCreated` lifecycle callback when a new thread is
   * created.
   *
   * @returns An object containing the thread and a `created` flag indicating
   *   whether the thread was newly created (`true`) or already existed (`false`).
   * @throws {@link PlatformRequestError} on non-2xx responses other than
   *   404 (get) and 409 (create race).
   */
  async getOrCreateThread(
    params: CreateThreadRequest,
  ): Promise<{ thread: ThreadSummary; created: boolean }> {
    try {
      const thread = await this.getThread({ threadId: params.threadId });
      return { thread, created: false };
    } catch (error) {
      if (!(error instanceof PlatformRequestError && error.status === 404)) {
        throw error;
      }
    }

    try {
      const thread = await this.createThread(params);
      return { thread, created: true };
    } catch (error) {
      // Another request created the thread between our get and create — retry get.
      if (error instanceof PlatformRequestError && error.status === 409) {
        const thread = await this.getThread({ threadId: params.threadId });
        return { thread, created: false };
      }
      throw error;
    }
  }

  /**
   * Fetch the full message history for a thread.
   *
   * @returns All persisted messages in chronological order.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async getThreadMessages(params: {
    threadId: string;
  }): Promise<ThreadMessagesResponse> {
    return this.#request<ThreadMessagesResponse>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}/messages`,
    );
  }

  /**
   * Mark a thread as archived.
   *
   * Archived threads are excluded from {@link listThreads} results.
   * Triggers the `onThreadUpdated` lifecycle callback on success.
   *
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async archiveThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
  }): Promise<void> {
    const response = await this.#request<ThreadEnvelope>(
      "PATCH",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
      { userId: params.userId, agentId: params.agentId, archived: true },
    );
    this.#invokeLifecycleCallback("onThreadUpdated", response.thread);
  }

  /**
   * Permanently delete a thread and its message history.
   *
   * This is irreversible. Triggers the `onThreadDeleted` lifecycle callback
   * on success.
   *
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async deleteThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
  }): Promise<void> {
    await this.#request<void>(
      "DELETE",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
      {
        reason: `Deleted via CopilotKit runtime (userId=${params.userId}, agentId=${params.agentId})`,
      },
    );
    this.#invokeLifecycleCallback("onThreadDeleted", params);
  }

  async ɵacquireThreadLock(
    params: AcquireThreadLockRequest,
  ): Promise<ThreadConnectionResponse> {
    return this.#request<ThreadConnectionResponse>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
      {
        runId: params.runId,
        userId: params.userId,
        ...(params.lockKeyPrefix !== undefined
          ? { lockKeyPrefix: params.lockKeyPrefix }
          : {}),
        ...(params.ttlSeconds !== undefined
          ? { ttlSeconds: params.ttlSeconds }
          : {}),
      },
    );
  }

  async ɵrenewThreadLock(
    params: RenewThreadLockRequest,
  ): Promise<RenewThreadLockResponse> {
    return this.#request<RenewThreadLockResponse>(
      "PATCH",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
      {
        runId: params.runId,
        ttlSeconds: params.ttlSeconds,
        ...(params.lockKeyPrefix !== undefined
          ? { lockKeyPrefix: params.lockKeyPrefix }
          : {}),
      },
    );
  }

  async ɵgetActiveJoinCode(params: {
    threadId: string;
    userId: string;
  }): Promise<ThreadConnectionResponse> {
    const qs = new URLSearchParams({ userId: params.userId }).toString();
    return this.#request<ThreadConnectionResponse>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}/join-code?${qs}`,
    );
  }

  async ɵconnectThread(params: {
    threadId: string;
    userId: string;
    runId?: string;
    lastSeenEventId?: string | null;
  }): Promise<ConnectThreadResponse> {
    const result = await this.#request<
      ConnectThreadBootstrapResponse | ConnectThreadLiveResponse
    >("POST", `/api/threads/${encodeURIComponent(params.threadId)}/connect`, {
      userId: params.userId,
      ...(params.runId !== undefined ? { runId: params.runId } : {}),
      ...(params.lastSeenEventId !== undefined
        ? { lastSeenEventId: params.lastSeenEventId }
        : {}),
    });

    // request() returns undefined for empty/204 responses
    return result ?? null;
  }
}

function normalizeIntelligenceWsUrl(wsUrl: string): string {
  return wsUrl.replace(/\/$/, "");
}

function deriveRunnerWsUrl(wsUrl: string): string {
  if (wsUrl.endsWith("/runner")) {
    return wsUrl;
  }

  if (wsUrl.endsWith("/client")) {
    return `${wsUrl.slice(0, -"/client".length)}/runner`;
  }

  return `${wsUrl}/runner`;
}

function deriveClientWsUrl(wsUrl: string): string {
  if (wsUrl.endsWith("/client")) {
    return wsUrl;
  }

  if (wsUrl.endsWith("/runner")) {
    return `${wsUrl.slice(0, -"/runner".length)}/client`;
  }

  return `${wsUrl}/client`;
}
