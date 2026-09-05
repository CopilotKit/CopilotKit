import {
  logger,
  parseInspectorLearningSnapshotV1,
  parseInspectorMetadataV1,
} from "@copilotkit/shared";
import type {
  InspectorLearningRequestV1,
  InspectorLearningSnapshotV1,
  InspectorMetadataV1,
  RuntimeEntitlementResponse,
} from "@copilotkit/shared";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { GetLearningContainerId } from "../core/learning";

const RUNTIME_ENTITLEMENTS_REQUEST_TIMEOUT_MS = 1_500;
const RUNTIME_ENTITLEMENTS_SUCCESS_TTL_MS = 30_000;
const RUNTIME_ENTITLEMENTS_NEGATIVE_TTL_MS = 5_000;

interface RuntimeEntitlementCacheEntry {
  readonly expiresAt: number;
  readonly response: RuntimeEntitlementResponse;
}

interface RuntimeEntitlementFailureEntry {
  readonly error: unknown;
  readonly expiresAt: number;
}

/** Whether a response grants Runtime access and therefore cannot be served stale. */
function grantsRuntimeAccess(response: RuntimeEntitlementResponse): boolean {
  return response.status === "ready" && response.entitlement.active;
}

/** Whether an HTTP status can recover without changing Runtime configuration. */
function isRetryableRuntimeEntitlementStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const runtimeEntitlementSchema = z
  .object({
    active: z.boolean(),
    source: z.enum([
      "managedOrgSubscription",
      "selfHostedDeploymentLicense",
      "awsMarketplaceDeploymentLicense",
    ]),
    features: z.record(z.string(), z.boolean()),
    limits: z.record(z.string(), z.number()),
    planCode: z.string().optional(),
    entitlementSource: z.string().optional(),
  })
  .strict();

const runtimeEntitlementResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      entitlement: runtimeEntitlementSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum(["degraded", "misconfigured", "unavailable"]),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          retryable: z.boolean(),
          requestId: z.string().optional(),
          traceId: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);

const legacyRuntimeEntitlementTransportSchema = runtimeEntitlementSchema.extend(
  {
    organizationId: z.string(),
  },
);

/** Check the published App API response union without widening its type. */
function isPublishedRuntimeEntitlementResponse(
  value: unknown,
): value is RuntimeEntitlementResponse {
  return runtimeEntitlementResponseSchema.safeParse(value).success;
}

/**
 * Validate the published App API response union, with flat-response support
 * during mixed-version rollouts.
 */
function normalizeRuntimeEntitlementTransport(
  value: unknown,
): RuntimeEntitlementResponse | undefined {
  if (isPublishedRuntimeEntitlementResponse(value)) {
    return value;
  }

  const legacyResponse =
    legacyRuntimeEntitlementTransportSchema.safeParse(value);
  if (!legacyResponse.success) {
    return undefined;
  }

  const transport = legacyResponse.data;
  return {
    status: "ready",
    entitlement: {
      active: transport.active,
      source: transport.source,
      features: transport.features,
      limits: transport.limits,
      ...(transport.planCode !== undefined
        ? { planCode: transport.planCode }
        : {}),
      ...(transport.entitlementSource !== undefined
        ? { entitlementSource: transport.entitlementSource }
        : {}),
    },
  };
}

/**
 * Header name carrying the per-call end-user identity that the CopilotKit
 * Intelligence `/mcp` endpoint requires. Internal CopilotKit machinery —
 * `attachIntelligenceEnterpriseLearning` resolves the user via `identifyUser`
 * and bakes this header onto the `MCPMiddleware`'s transport config, so every
 * outbound MCP request stamps `X-Cpki-User-Id: <userId>`. Not part of the
 * public user API.
 *
 * @internal
 */
export const INTELLIGENCE_USER_ID_HEADER = "x-cpki-user-id";
/** Immutable user/project Memory grant forwarded to Intelligence. */
export const INTELLIGENCE_MEMORY_GRANT_HEADER = "x-cpki-memory-grant";

interface RuntimeMemoryGrant {
  readonly user: "none" | "read" | "read-write";
  readonly project: "none" | "read" | "read-write";
}

const memoryRequestHeaders = (
  userId: string,
  grant?: RuntimeMemoryGrant,
): Record<string, string> => ({
  [INTELLIGENCE_USER_ID_HEADER]: userId,
  ...(grant
    ? { [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify(grant) }
    : {}),
});

/**
 * REST base URL of cloud-hosted CopilotKit Intelligence — the default
 * when {@link CopilotKitIntelligenceConfig.apiUrl} is omitted.
 */
const MANAGED_INTELLIGENCE_API_URL = "https://api.intelligence.copilotkit.ai";

/**
 * Websocket base URL of cloud-hosted CopilotKit Intelligence — the
 * default when {@link CopilotKitIntelligenceConfig.wsUrl} is omitted.
 *
 * A different host from {@link MANAGED_INTELLIGENCE_API_URL}: the API and
 * realtime planes are deployed separately.
 */
const MANAGED_INTELLIGENCE_WS_URL = "wss://realtime.intelligence.copilotkit.ai";

/** Maximum time spent on the optional Inspector metadata provider request. */
const INSPECTOR_METADATA_REQUEST_TIMEOUT_MS = 5_000;
const INSPECTOR_LEARNING_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Error thrown when a CopilotKit Intelligence HTTP request returns a non-2xx
 * status. Carries the HTTP {@link status} code so callers can branch on
 * specific failures (e.g. 404 for "not found", 409 for "conflict") without
 * parsing the error message string.
 *
 * @example
 * ```ts
 * try {
 *   await intelligence.getThread({ threadId, userId });
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
    /** Whether retrying may succeed without changing client configuration. */
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "PlatformRequestError";
  }
}

/** Copy a public Runtime entitlement so callers cannot mutate cached authority. */
function cloneRuntimeEntitlementResponse(
  response: RuntimeEntitlementResponse,
): RuntimeEntitlementResponse {
  if (response.status === "ready") {
    return {
      status: "ready",
      entitlement: {
        ...response.entitlement,
        features: { ...response.entitlement.features },
        limits: { ...response.entitlement.limits },
      },
    };
  }

  return {
    status: response.status,
    error: { ...response.error },
  };
}

/** Copy a cached Error while preserving its concrete type and own fields. */
function cloneRuntimeEntitlementError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  return Object.create(
    Object.getPrototypeOf(error),
    Object.getOwnPropertyDescriptors(error),
  ) as Error;
}

/** Payload passed to `onThreadDeleted` listeners. */
export interface ThreadDeletedPayload {
  threadId: string;
  userId: string;
  agentId: string;
}

export interface CopilotKitIntelligenceConfig {
  /**
   * Base URL of the CopilotKit Intelligence API.
   *
   * Defaults to CopilotKit's managed platform,
   * `https://api.intelligence.copilotkit.ai`. Set it only when pointing at a
   * self-hosted or non-production deployment — and set {@link wsUrl} with it.
   */
  apiUrl?: string;
  /**
   * Intelligence websocket base URL. Runner and client socket URLs are derived
   * from this by appending `/runner` or `/client`, so pass the bare base.
   *
   * Defaults to CopilotKit's managed platform,
   * `wss://realtime.intelligence.copilotkit.ai`.
   *
   * This is a DIFFERENT host from {@link apiUrl} — the API and realtime planes are
   * deployed separately — so it cannot be derived by scheme-swapping `apiUrl`.
   * Overriding one without the other therefore points the two planes at
   * different deployments, which logs a warning.
   */
  wsUrl?: string;
  /** API key for authenticating with CopilotKit Intelligence */
  apiKey: string;
  /**
   * Chooses the stable Learning Container ID for each Intelligence run.
   * The callback receives the resolved application user and AG-UI run input.
   * It must return the same ID for every run on one Thread because a Thread
   * cannot move between Learning Containers after its first assignment.
   * Return `null` or `undefined` to leave the Thread unassigned.
   */
  getLearningContainerId?: GetLearningContainerId;
  /**
   * Enable Enterprise Learning — expose CopilotKit Intelligence's
   * built-in tools (bash + thread/memory tools) to agent runs on an
   * intelligence runtime that resolve a user. Attached uniformly across
   * agent frameworks by `attachIntelligenceEnterpriseLearning` via
   * `@ag-ui/mcp-middleware`, with the resolved user-id and project apiKey
   * baked into the transport headers for that request's clone.
   *
   * Defaults to `false` — opt-in. Existing intelligence setups continue
   * to work without these tools unless they flip this flag.
   *
   * @deprecated Configure `memory.access` on `CopilotRuntime` so each web
   * request receives an explicit agent or client Memory grant.
   */
  enableEnterpriseLearning?: boolean;
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
 * A single memory as returned by the platform's list endpoint. Mirrors the
 * public projection the client memory store consumes (tenant ids stripped).
 */
export interface MemorySummary {
  /** Platform-assigned unique identifier. */
  id: string;
  /** Memory kind, e.g. `"topical"`, `"episodic"`, `"operational"`. */
  kind: string;
  /** Memory scope: `"user"` (private) or `"project"` (shared). */
  scope: string;
  /** The remembered fact, preference, or procedure. */
  content: string;
  /** Ids of the threads this memory was learned from. */
  sourceThreadIds: string[];
  /** ISO-8601 timestamp when the memory was retired, or `null` if live. */
  invalidatedAt: string | null;
  /** Relevance score from a `recall` (hybrid RAG) query. Present only on recall responses. */
  score?: number;
}

/** Response from {@link CopilotKitIntelligence.listMemories}. */
export interface ListMemoriesResponse {
  memories: MemorySummary[];
}

/** Response from {@link CopilotKitIntelligence.recallMemories}. */
export interface RecallMemoriesResponse {
  memories: MemorySummary[];
}

/**
 * Response from a create ({@link CopilotKitIntelligence.createMemory}) or
 * supersede ({@link CopilotKitIntelligence.updateMemory}) call: the stored
 * memory, plus the operation-specific marker the client store consumes.
 */
export interface SaveMemoryResponse extends MemorySummary {
  /** Create only: content was merged into a near-duplicate, not inserted new. */
  absorbed?: boolean;
  /** Supersede only: the id of the memory retired by this call. */
  retiredId?: string;
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
  /** Developer-set stable ID of the Learning Container for this Thread. */
  learningContainerId?: string;
}

/** Credentials returned when locking or joining a thread's realtime channel. */
export interface ThreadConnectionResponse {
  /** Canonical platform thread identifier for the run or connection. */
  threadId: string;
  /** Canonical platform run identifier for an active run lock. */
  runId?: string;
  /** Short-lived token for authenticating the Phoenix channel join. */
  joinToken: string;
  /** Lock metadata echoed back by the platform. */
  lock?: ThreadLockInfo;
}

export interface SubscribeToThreadsRequest {
  userId: string;
}

export interface SubscribeToThreadsResponse {
  joinToken: string;
}

export interface SubscribeToMemoriesRequest {
  userId: string;
  memoryGrant?: RuntimeMemoryGrant;
}

/**
 * Memory subscribe returns both the token and the join code, unlike threads
 * (whose join code reaches the client via the thread-list response). Memory has
 * no list-borne code, so the code is delivered here and used to build the
 * `user_meta:memories:<joinCode>` channel topic.
 */
export interface SubscribeToMemoriesResponse {
  joinToken?: string;
  joinCode?: string;
  /**
   * Project-scoped realtime credentials, minted by the platform only when the
   * caller's API key resolves to a project scope. Absent when project scope is
   * unavailable — a silent-degrade contract: the client then opens only the
   * user channel. When present, the client builds the second
   * `project_meta:memories:<projectJoinCode>` channel topic from them.
   */
  projectJoinToken?: string;
  projectJoinCode?: string;
}

export type ConnectThreadResponse = ThreadConnectionResponse | null;

export interface AcquireThreadLockResponse extends ThreadConnectionResponse {
  /** Canonical platform run identifier for the acquired lock. */
  runId: string;
}

/**
 * Parameters for annotating a thread event via
 * {@link CopilotKitIntelligence.annotate}. The runtime resolves `userId`
 * from the customer's BFF auth before calling this; the platform prefixes
 * it with the project id at write time.
 *
 * `payload` is the type-specific JSON blob for the annotation (for example, a
 * `"user_action"` event carries the recorded fields). The exact
 * shape per type is validated by the Intelligence backend; canonical shapes
 * are documented on the Intelligence react-core side.
 */
export interface AnnotateParams {
  /** The user the annotation belongs to. */
  userId: string;
  /** The thread the annotation is associated with. May be unknown to the platform. */
  threadId: string;
  /**
   * Discriminator identifying the annotation type.
   * Must match a type known to CopilotKit Intelligence
   * (for example, `"user_action"`).
   */
  type: string;
  /** Type-specific payload. Shape varies by `type`. */
  payload?: unknown;
  /**
   * Caller-supplied idempotency key (any RFC-compliant UUID). When omitted,
   * a UUID is auto-generated. Every call hits the platform's idempotent
   * `PUT /connector/annotate/:clientEventId` endpoint; a retry with the
   * same id collapses to the original row.
   */
  clientEventId?: string;
  /** ISO-8601 client-asserted timestamp. Defaults to server NOW() when absent. */
  occurredAt?: string;
}

/** Response from {@link CopilotKitIntelligence.annotate}. */
export interface AnnotateResponse {
  /** Database id of the annotation row (BIGINT, returned as a string). */
  id: string;
  /**
   * True when the platform recognized the `clientEventId` as a retry of
   * a previous call and returned the original row id instead of inserting
   * a new one.
   */
  duplicate: boolean;
}

/** A single message within a thread's persisted history. */
export interface ThreadMessage {
  /** Unique identifier for this message. */
  id: string;
  /** Message role, e.g. `"user"`, `"assistant"`, `"tool"`. */
  role: string;
  /** Structured AG-UI content. May be absent for tool-call-only messages. */
  content?: unknown;
  /** Standard AG-UI activity type when `role` is `"activity"`. */
  activityType?: string;
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

/**
 * Persisted AG-UI event for the inspector's debugging views. The platform
 * stores raw events keyed by run; the `_inspect` route returns them in
 * replay order (oldest first) across every run that targeted the thread.
 */
export interface ThreadInspectEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Response from {@link CopilotKitIntelligence.getThreadEvents}. Mirrors the
 * `ThreadEventsResult` shape returned by the platform's
 * `GET /api/_inspect/threads/:id/events` endpoint.
 */
export interface ThreadEventsResponse {
  events: ThreadInspectEvent[];
  /** Row IDs the platform failed to decode (raw column corrupted). */
  decodeErrorRowIds: string[];
  /** True when the platform hit its per-thread event cap. */
  truncated: boolean;
}

/**
 * Response from {@link CopilotKitIntelligence.getThreadState}. Mirrors the
 * discriminated `ThreadStateResult` returned by the platform's
 * `GET /api/_inspect/threads/:id/state` endpoint, which folds RFC 6902
 * STATE_DELTA events on top of the latest STATE_SNAPSHOT.
 */
export type ThreadStateResponse =
  | { kind: "no-snapshot" }
  | { kind: "snapshot-decode-error" }
  | { kind: "snapshot"; state: unknown; skippedDeltas: number };

export interface AcquireThreadLockRequest {
  threadId: string;
  runId: string;
  userId: string;
  agentId: string;
  /** Developer-set stable ID to assign before the run lock is acquired. */
  learningContainerId?: string;
  /** Internal managed-Channel delivery context for shared Thread access. */
  channelDeliveryId?: string;
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

export interface CleanupThreadLockRequest {
  threadId: string;
  runId: string;
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

/**
 * Client for the CopilotKit Intelligence REST API.
 *
 * Construct the client once and pass it to any consumers that need it
 * (e.g. `CopilotRuntime`, `IntelligenceAgentRunner`):
 *
 * ```ts
 * import { CopilotKitIntelligence, CopilotRuntime } from "@copilotkit/runtime";
 *
 * const intelligence = new CopilotKitIntelligence({
 *   apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
 * });
 *
 * const runtime = new CopilotRuntime({
 *   agents,
 *   intelligence,
 * });
 * ```
 *
 * `apiUrl` and `wsUrl` default to cloud-hosted CopilotKit Intelligence —
 * `https://api.intelligence.copilotkit.ai` and
 * `wss://realtime.intelligence.copilotkit.ai`. Those are the values for the
 * managed service; leaving both unset is always correct against it.
 *
 * Override both together to target a non-production or future self-hosted
 * deployment (the hosts below are placeholders — substitute your own):
 *
 * ```ts
 * const intelligence = new CopilotKitIntelligence({
 *   apiUrl: "https://api.intelligence.example.com",
 *   wsUrl: "wss://realtime.intelligence.example.com",
 *   apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
 * });
 * ```
 */
export class CopilotKitIntelligence {
  #apiUrl: string;
  #runnerWsUrl: string;
  #clientWsUrl: string;
  #channelsWsUrl: string;
  #apiKey: string;
  #enterpriseLearningEnabled: boolean;
  #getLearningContainerId?: GetLearningContainerId;
  #runtimeEntitlementsCache?: RuntimeEntitlementCacheEntry;
  #runtimeEntitlementsFailure?: RuntimeEntitlementFailureEntry;
  #runtimeEntitlementsInFlight?: Promise<RuntimeEntitlementResponse>;
  #threadCreatedListeners = new Set<(thread: ThreadSummary) => void>();
  #threadUpdatedListeners = new Set<(thread: ThreadSummary) => void>();
  #threadDeletedListeners = new Set<(params: ThreadDeletedPayload) => void>();

  constructor(config: CopilotKitIntelligenceConfig) {
    if (
      config.getLearningContainerId !== undefined &&
      typeof config.getLearningContainerId !== "function"
    ) {
      throw new Error(
        "CopilotKitIntelligence `getLearningContainerId` must be a callback",
      );
    }
    assertConfiguredApiKey(config.apiKey);
    const configuredApiUrl = configuredUrl(config.apiUrl);
    const configuredWsUrl = configuredUrl(config.wsUrl);
    warnOnPartialHostOverride(configuredApiUrl, configuredWsUrl);

    const intelligenceWsUrl = normalizeIntelligenceWsUrl(
      configuredWsUrl ?? MANAGED_INTELLIGENCE_WS_URL,
    );

    this.#apiUrl = (configuredApiUrl ?? MANAGED_INTELLIGENCE_API_URL).replace(
      /\/$/,
      "",
    );
    this.#runnerWsUrl = deriveRunnerWsUrl(intelligenceWsUrl);
    this.#clientWsUrl = deriveClientWsUrl(intelligenceWsUrl);
    this.#channelsWsUrl = deriveChannelsWsUrl(intelligenceWsUrl);
    this.#apiKey = config.apiKey;
    this.#enterpriseLearningEnabled = config.enableEnterpriseLearning ?? false;
    this.#getLearningContainerId = config.getLearningContainerId;

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

  ɵgetChannelsWsUrl(): string {
    return this.#channelsWsUrl;
  }

  ɵgetRunnerAuthToken(): string {
    return this.#apiKey;
  }

  /** @internal Used by `attachIntelligenceEnterpriseLearning` to populate `Authorization`. */
  ɵgetApiKey(): string {
    return this.#apiKey;
  }

  /** @internal Used by the Intelligence runtime to assign Learning Containers. */
  ɵgetLearningContainerId(): GetLearningContainerId | undefined {
    return this.#getLearningContainerId;
  }

  /** @internal Used by `attachIntelligenceEnterpriseLearning` to gate MCP attachment. */
  ɵisEnterpriseLearningEnabled(): boolean {
    return this.#enterpriseLearningEnabled;
  }

  /**
   * Fetch trusted Inspector metadata for this runtime's Intelligence project.
   *
   * The request always uses the server-configured Intelligence API key. A 404
   * is treated as compatible absence so runtimes can work with older App API
   * deployments that do not expose this endpoint yet.
   *
   * @returns Sanitized V1 metadata, or `undefined` when the provider has no
   *   supported metadata.
   * @throws {@link PlatformRequestError} for provider failures other than 404.
   */
  async getInspectorMetadata(): Promise<InspectorMetadataV1 | undefined> {
    const path = "/api/inspector/metadata";
    const abortController = new AbortController();
    const timeoutError = new Error(
      "Intelligence inspector metadata request timed out",
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(timeoutError);
        abortController.abort(timeoutError);
      }, INSPECTOR_METADATA_REQUEST_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([
        fetch(`${this.#apiUrl}${path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.#apiKey}` },
          signal: abortController.signal,
        }),
        timeout,
      ]);

      if (response.status === 204 || response.status === 404) {
        return undefined;
      }

      if (!response.ok) {
        logger.error(
          { status: response.status, path },
          "Intelligence platform request failed",
        );
        throw new PlatformRequestError(
          `Intelligence platform error ${response.status}`,
          response.status,
        );
      }

      const body = await Promise.race([response.text(), timeout]);
      const decoded: unknown = JSON.parse(body);
      return parseInspectorMetadataV1(decoded);
    } catch (error) {
      if (error === timeoutError) {
        logger.warn(
          { path, timeoutMs: INSPECTOR_METADATA_REQUEST_TIMEOUT_MS },
          "Intelligence inspector metadata request timed out",
        );
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /** Fetches one credential-scoped, bounded Learning projection for Inspector. */
  async getInspectorLearning(
    request: InspectorLearningRequestV1 & {
      readonly runtimeContainerId?: string;
    },
  ): Promise<InspectorLearningSnapshotV1> {
    const path = "/api/inspector/learning";
    const url = new URL(`${this.#apiUrl}${path}`);
    if (request.agentId) url.searchParams.set("agentId", request.agentId);
    if (request.skillsPage)
      url.searchParams.set("skillsPage", String(request.skillsPage));
    if (request.insightsPage) {
      url.searchParams.set("insightsPage", String(request.insightsPage));
    }
    if (request.runtimeContainerId) {
      url.searchParams.set("runtimeContainerId", request.runtimeContainerId);
    }
    const controller = new AbortController();
    const timeoutError = new Error(
      "Intelligence Inspector Learning request timed out",
    );
    const timeout = setTimeout(
      () => controller.abort(timeoutError),
      INSPECTOR_LEARNING_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PlatformRequestError(
          `Intelligence platform error ${response.status}`,
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }
      const snapshot = parseInspectorLearningSnapshotV1(await response.json());
      if (!snapshot) {
        throw new PlatformRequestError(
          "Invalid Inspector Learning response",
          502,
          true,
        );
      }
      return snapshot;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resolve the Runtime entitlement projection for this project.
   *
   * Concurrent calls share one request. Active grants cache for 30 seconds;
   * inactive results and failures cache for 5 seconds. Callers receive copies
   * so they cannot mutate cached authority.
   */
  async getRuntimeEntitlements(): Promise<RuntimeEntitlementResponse> {
    const now = Date.now();
    if (
      this.#runtimeEntitlementsCache &&
      now < this.#runtimeEntitlementsCache.expiresAt
    ) {
      return cloneRuntimeEntitlementResponse(
        this.#runtimeEntitlementsCache.response,
      );
    }
    if (
      this.#runtimeEntitlementsFailure &&
      now < this.#runtimeEntitlementsFailure.expiresAt
    ) {
      throw cloneRuntimeEntitlementError(
        this.#runtimeEntitlementsFailure.error,
      );
    }

    const request =
      this.#runtimeEntitlementsInFlight ??
      this.#fetchRuntimeEntitlements()
        .then((response) => {
          this.#runtimeEntitlementsFailure = undefined;
          this.#runtimeEntitlementsCache = {
            response,
            expiresAt:
              Date.now() +
              (grantsRuntimeAccess(response)
                ? RUNTIME_ENTITLEMENTS_SUCCESS_TTL_MS
                : RUNTIME_ENTITLEMENTS_NEGATIVE_TTL_MS),
          };
          return response;
        })
        .catch((error: unknown) => {
          this.#runtimeEntitlementsFailure = {
            error,
            expiresAt: Date.now() + RUNTIME_ENTITLEMENTS_NEGATIVE_TTL_MS,
          };
          throw error;
        });
    this.#runtimeEntitlementsInFlight = request;
    try {
      return cloneRuntimeEntitlementResponse(await request);
    } catch (error) {
      throw cloneRuntimeEntitlementError(error);
    } finally {
      if (this.#runtimeEntitlementsInFlight === request) {
        this.#runtimeEntitlementsInFlight = undefined;
      }
    }
  }

  /** Perform one bounded Runtime entitlement request without caching. */
  async #fetchRuntimeEntitlements(): Promise<RuntimeEntitlementResponse> {
    const path = "/api/entitlements/runtime";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RUNTIME_ENTITLEMENTS_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${this.#apiUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        logger.error(
          { status: response.status, path },
          "Runtime entitlement request failed",
        );
        throw new PlatformRequestError(
          `Runtime entitlement request failed with status ${response.status}`,
          response.status,
          isRetryableRuntimeEntitlementStatus(response.status),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PlatformRequestError(
          "Runtime entitlement response was malformed",
          502,
          false,
        );
      }

      const normalized = normalizeRuntimeEntitlementTransport(payload);
      if (!normalized) {
        throw new PlatformRequestError(
          "Runtime entitlement response was malformed",
          502,
          false,
        );
      }
      return normalized;
    } catch (error) {
      if (error instanceof PlatformRequestError) {
        throw error;
      }
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new PlatformRequestError(
          "Runtime entitlement request timed out",
          504,
          true,
        );
      }
      throw new PlatformRequestError(
        "Runtime entitlement request failed",
        502,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.#apiUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
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
        (callback as (p: typeof payload) => void)(payload);
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

  /**
   * List the given user's long-term memories, newest first.
   *
   * The platform scopes by the opaque app user supplied in the
   * `x-cpki-user-id` header (resolved by the runtime via `identifyUser`),
   * not a query param. Pass `includeInvalidated` to also return retired rows.
   *
   * @returns The `{ memories }` envelope the client memory store consumes.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async listMemories(params: {
    userId: string;
    memoryGrant?: RuntimeMemoryGrant;
    includeInvalidated?: boolean;
  }): Promise<ListMemoriesResponse> {
    const qs = params.includeInvalidated ? "?includeInvalidated=true" : "";
    return this.#request<ListMemoriesResponse>(
      "GET",
      `/api/memories${qs}`,
      undefined,
      memoryRequestHeaders(params.userId, params.memoryGrant),
    );
  }

  /**
   * Create a memory for the given user (platform `POST /api/memories`).
   * @returns The stored memory; `absorbed` is true if the content was merged
   *   into a near-duplicate rather than inserted as a new row.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async createMemory(params: {
    userId: string;
    memoryGrant?: RuntimeMemoryGrant;
    content: string;
    kind: string;
    /** Optional: when omitted, the platform applies its default (`"user"`). */
    scope?: string;
    sourceThreadIds?: string[];
  }): Promise<SaveMemoryResponse> {
    return this.#request<SaveMemoryResponse>(
      "POST",
      `/api/memories`,
      {
        content: params.content,
        kind: params.kind,
        ...(params.scope !== undefined ? { scope: params.scope } : {}),
        sourceThreadIds: params.sourceThreadIds ?? [],
      },
      memoryRequestHeaders(params.userId, params.memoryGrant),
    );
  }

  /**
   * Supersede an existing memory (platform `PATCH /api/memories/:id`). The
   * `:id` row is retired and a new memory with the supplied content is
   * inserted atomically.
   * @returns The new memory plus `retiredId` (the id of the retired row).
   * @throws {@link PlatformRequestError} on non-2xx responses (e.g. 404 when
   *   `:id` is not a live, same-scope memory for this user).
   */
  async updateMemory(params: {
    userId: string;
    memoryGrant?: RuntimeMemoryGrant;
    id: string;
    content: string;
    kind: string;
    /** Optional: when omitted, the platform applies its default (`"user"`). */
    scope?: string;
    sourceThreadIds?: string[];
  }): Promise<SaveMemoryResponse> {
    return this.#request<SaveMemoryResponse>(
      "PATCH",
      `/api/memories/${encodeURIComponent(params.id)}`,
      {
        content: params.content,
        kind: params.kind,
        ...(params.scope !== undefined ? { scope: params.scope } : {}),
        sourceThreadIds: params.sourceThreadIds ?? [],
      },
      memoryRequestHeaders(params.userId, params.memoryGrant),
    );
  }

  /**
   * Non-lossily retire (forget) a memory (platform `DELETE /api/memories/:id`).
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async removeMemory(params: {
    userId: string;
    id: string;
    memoryGrant?: RuntimeMemoryGrant;
  }): Promise<void> {
    await this.#request<void>(
      "DELETE",
      `/api/memories/${encodeURIComponent(params.id)}`,
      undefined,
      memoryRequestHeaders(params.userId, params.memoryGrant),
    );
  }

  /**
   * Semantically recall the given user's memories (platform `POST
   * /api/memories/recall`, hybrid RAG). Each returned memory carries a
   * relevance `score`. `scope` narrows to `"user"`/`"project"`; omitted → platform default.
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async recallMemories(params: {
    userId: string;
    memoryGrant?: RuntimeMemoryGrant;
    query: string;
    limit?: number;
    scope?: string;
  }): Promise<RecallMemoriesResponse> {
    return this.#request<RecallMemoriesResponse>(
      "POST",
      `/api/memories/recall`,
      {
        query: params.query,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.scope !== undefined ? { scope: params.scope } : {}),
      },
      memoryRequestHeaders(params.userId, params.memoryGrant),
    );
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
   * Mint memory-realtime join credentials (platform `POST
   * /api/memories/subscribe`). Returns both the single-use `joinToken` and the
   * per-user `joinCode` the client needs to build the
   * `user_meta:memories:<joinCode>` channel topic. When the platform also
   * resolves a project scope it returns optional `projectJoinToken` /
   * `projectJoinCode`; both are passed through verbatim (omitted when absent,
   * the silent-degrade contract).
   *
   * The user is supplied via the `x-cpki-user-id` header — the same way every
   * other memory endpoint (`listMemories`/`createMemory`/…) identifies the app
   * user — because the platform's memory routes resolve identity from that
   * header, not the body. (This differs from `ɵsubscribeToThreads`, whose
   * platform endpoint reads `userId` from the body.)
   *
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async ɵsubscribeToMemories(
    params: SubscribeToMemoriesRequest,
  ): Promise<SubscribeToMemoriesResponse> {
    return this.#request<SubscribeToMemoriesResponse>(
      "POST",
      "/api/memories/subscribe",
      undefined,
      memoryRequestHeaders(params.userId, params.memoryGrant),
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
        ...(params.learningContainerId !== undefined
          ? { learningContainerId: params.learningContainerId }
          : {}),
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
  async getThread(params: {
    threadId: string;
    userId: string;
  }): Promise<ThreadSummary> {
    const qs = new URLSearchParams({ userId: params.userId }).toString();
    const response = await this.#request<ThreadEnvelope>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}?${qs}`,
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
      const thread = await this.getThread({
        threadId: params.threadId,
        userId: params.userId,
      });
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
        const thread = await this.getThread({
          threadId: params.threadId,
          userId: params.userId,
        });
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
    userId: string;
    /** Internal managed-Channel delivery context for shared Thread access. */
    channelDeliveryId?: string;
  }): Promise<ThreadMessagesResponse> {
    const qs = new URLSearchParams({ userId: params.userId }).toString();
    return this.#request<ThreadMessagesResponse>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}/messages?${qs}`,
      undefined,
      params.channelDeliveryId
        ? { "X-Cpki-Channel-Delivery-Id": params.channelDeliveryId }
        : undefined,
    );
  }

  /** @internal Fetches one authorized managed Channel asset for history hydration. */
  async ɵgetManagedChannelAsset(assetId: string): Promise<{
    bytes: Uint8Array;
    mimeType?: string;
  }> {
    const path = `/api/channels/files/${encodeURIComponent(assetId)}`;
    const response = await fetch(`${this.#apiUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.#apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PlatformRequestError(
        `Intelligence platform error ${response.status}: ${text || response.statusText}`,
        response.status,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? undefined;
    return { bytes, ...(mimeType ? { mimeType } : {}) };
  }

  /**
   * Fetch the persisted AG-UI event stream for a thread.
   *
   * Backed by the platform's `GET /api/_inspect/threads/:id/events`
   * introspection endpoint (see Intelligence PR #144). Events are returned
   * in replay order across every run that targeted the thread. The
   * `_inspect/` prefix flags this as debug-only — production code paths
   * must not depend on it.
   *
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async getThreadEvents(params: {
    threadId: string;
  }): Promise<ThreadEventsResponse> {
    return this.#request<ThreadEventsResponse>(
      "GET",
      `/api/_inspect/threads/${encodeURIComponent(params.threadId)}/events`,
    );
  }

  /**
   * Fetch the current agent state for a thread.
   *
   * Backed by the platform's `GET /api/_inspect/threads/:id/state`
   * introspection endpoint (see Intelligence PR #144). The platform folds
   * RFC 6902 STATE_DELTA events on top of the latest STATE_SNAPSHOT, so
   * the returned state reflects the thread's current state — not just the
   * last snapshot. The discriminated response distinguishes "no snapshot
   * persisted yet" from "snapshot present" so consumers can render the
   * correct empty state.
   *
   * @throws {@link PlatformRequestError} on non-2xx responses.
   */
  async getThreadState(params: {
    threadId: string;
  }): Promise<ThreadStateResponse> {
    return this.#request<ThreadStateResponse>(
      "GET",
      `/api/_inspect/threads/${encodeURIComponent(params.threadId)}/state`,
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
        userId: params.userId,
        agentId: params.agentId,
        reason: `Deleted via CopilotKit runtime (userId=${params.userId}, agentId=${params.agentId})`,
      },
    );
    this.#invokeLifecycleCallback("onThreadDeleted", params);
  }

  /**
   * Annotate a thread event on CopilotKit Intelligence's general annotation
   * endpoint (`PUT /connector/annotate/:clientEventId`).
   *
   * This is the generalized replacement for the old
   * `PUT /connector/user-actions/record/:clientEventId` endpoint. It supports
   * multiple annotation types via the `type` discriminator. The
   * `"user_action"` type records a user UI interaction for the self-learning
   * loop.
   *
   * `userId` must be resolved on the runtime side before calling this — the
   * platform prefixes it with the project id from the API key.
   *
   * Always hits the idempotent `PUT /connector/annotate/:clientEventId`
   * endpoint. A retry with the same `clientEventId` returns
   * `{ id: <original>, duplicate: true }` instead of creating a new row.
   * When `clientEventId` is omitted, a UUID is auto-generated for this call.
   *
   * @throws {@link PlatformRequestError} on non-2xx responses, OR when the
   *   platform returns an empty 2xx body (which would otherwise corrupt the
   *   caller's typed result).
   */
  async annotate(params: AnnotateParams): Promise<AnnotateResponse> {
    const clientEventId = params.clientEventId ?? randomUUID();
    const path = `/connector/annotate/${encodeURIComponent(clientEventId)}`;
    const body: Record<string, unknown> = {
      type: params.type,
      userId: params.userId,
      threadId: params.threadId,
    };
    if (params.payload !== undefined) {
      body.payload = params.payload;
    }
    if (params.occurredAt !== undefined) {
      body.occurredAt = params.occurredAt;
    }
    const response = await this.#request<AnnotateResponse | null | undefined>(
      "PUT",
      path,
      body,
    );
    // `== null` catches both `undefined` (empty body from `#request`)
    // and JSON `null` (which would otherwise corrupt the typed result
    // and surface as a `TypeError` deep in caller code).
    if (response == null) {
      logger.error(
        { path },
        "annotate: Intelligence platform returned 200 with empty or null body",
      );
      throw new PlatformRequestError(
        "annotate: empty or null response body from Intelligence platform",
        502,
      );
    }
    return response;
  }

  async ɵacquireThreadLock(
    params: AcquireThreadLockRequest,
  ): Promise<AcquireThreadLockResponse> {
    return this.#request<AcquireThreadLockResponse>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
      {
        runId: params.runId,
        userId: params.userId,
        agentId: params.agentId,
        ...(params.learningContainerId !== undefined
          ? { learningContainerId: params.learningContainerId }
          : {}),
        ...(params.lockKeyPrefix !== undefined
          ? { lockKeyPrefix: params.lockKeyPrefix }
          : {}),
        ...(params.ttlSeconds !== undefined
          ? { ttlSeconds: params.ttlSeconds }
          : {}),
      },
      params.channelDeliveryId
        ? { "X-Cpki-Channel-Delivery-Id": params.channelDeliveryId }
        : undefined,
    );
  }

  async ɵcleanupThreadLock(params: CleanupThreadLockRequest): Promise<void> {
    return this.#request<void>(
      "DELETE",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
      {
        runId: params.runId,
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
    agentId: string;
  }): Promise<ConnectThreadResponse> {
    const result = await this.#request<ThreadConnectionResponse>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/connect`,
      {
        userId: params.userId,
        agentId: params.agentId,
      },
    );

    // request() returns undefined for empty/204 responses
    return result ?? null;
  }
}

/**
 * Normalize a configured URL to "provided" or "not provided". A blank string
 * counts as not provided: these URLs are typically wired from environment
 * variables, and a declared-but-empty variable (`COPILOTKIT_INTELLIGENCE_URL=`,
 * common in generated `.env` files and container configs) arrives as `""`. Left
 * as-is it would produce host-relative requests instead of falling back to the
 * managed platform.
 */
function configuredUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Reject an Intelligence project API key that carries no credential.
 *
 * `apiKey` is required on the config type, so TypeScript catches an absent
 * property. It does not catch an empty one, and the common shape is a
 * `process.env` read that TypeScript is told to trust — `?? ""` in the starter
 * wiring block, `!` in this file's own examples. When the variable is unset,
 * both produce a blank key that is sent verbatim as `Authorization: Bearer `
 * and fails much later as a 401 that points at nothing.
 *
 * A runtime with no credential cannot serve managed Intelligence, so this
 * throws at construction: callers build the client during boot, which puts the
 * error at startup rather than on a user's first message.
 */
function assertConfiguredApiKey(apiKey: string): void {
  if (typeof apiKey === "string" && apiKey.trim() !== "") {
    return;
  }
  // The whole key is a `cpk-…` secret, so name the variable that carries it
  // and echo none of the value — the same rule `parseProjectIdFromApiKey`
  // follows for a malformed key.
  throw new Error(
    "CopilotKitIntelligence `apiKey` is required and cannot be blank. It is " +
      "the CopilotKit Intelligence project API key, normally read from the " +
      "CPK_INTELLIGENCE_API_KEY environment variable. Run `copilotkit " +
      "project select` to provision one for your project.",
  );
}

/**
 * Warn when exactly one of `apiUrl`/`wsUrl` is configured. The API and realtime
 * planes are separate hosts, so a lone override silently leaves the other plane
 * on CopilotKit's managed platform — a self-hosted API paired with the managed
 * gateway (or vice versa), which fails as a hang rather than an error.
 */
function warnOnPartialHostOverride(
  apiUrl: string | undefined,
  wsUrl: string | undefined,
): void {
  if (apiUrl && !wsUrl) {
    logger.warn(
      `CopilotKitIntelligence: apiUrl is set to "${apiUrl}" but wsUrl is not, ` +
        `so wsUrl falls back to the managed default "${MANAGED_INTELLIGENCE_WS_URL}". ` +
        `The API and realtime planes are separate hosts — set both when pointing at a self-hosted deployment.`,
    );
    return;
  }

  if (wsUrl && !apiUrl) {
    logger.warn(
      `CopilotKitIntelligence: wsUrl is set to "${wsUrl}" but apiUrl is not, ` +
        `so apiUrl falls back to the managed default "${MANAGED_INTELLIGENCE_API_URL}". ` +
        `The API and realtime planes are separate hosts — set both when pointing at a self-hosted deployment.`,
    );
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

  if (wsUrl.endsWith("/channels")) {
    return `${wsUrl.slice(0, -"/channels".length)}/runner`;
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

  if (wsUrl.endsWith("/channels")) {
    return `${wsUrl.slice(0, -"/channels".length)}/client`;
  }

  return `${wsUrl}/client`;
}

function deriveChannelsWsUrl(wsUrl: string): string {
  if (wsUrl.endsWith("/channels")) return wsUrl;
  if (wsUrl.endsWith("/runner")) {
    return `${wsUrl.slice(0, -"/runner".length)}/channels`;
  }
  if (wsUrl.endsWith("/client")) {
    return `${wsUrl.slice(0, -"/client".length)}/channels`;
  }
  return `${wsUrl}/channels`;
}
