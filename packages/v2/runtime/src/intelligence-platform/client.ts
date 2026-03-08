import { logger } from "@copilotkitnext/shared";
import type { BaseEvent } from "@ag-ui/client";

/**
 * Client for the CopilotKit Intelligence Platform REST API.
 *
 * Construct the client once and pass it to any consumers that need it
 * (e.g. `CopilotRuntime`, `IntelligenceAgentRunner`):
 *
 * ```ts
 * import { CopilotIntelligenceSdk, CopilotRuntime } from "@copilotkitnext/runtime";
 *
 * const sdk = new CopilotIntelligenceSdk({
 *   apiUrl: "https://api.copilotkit.ai",
 *   wsUrl: "wss://api.copilotkit.ai",
 *   apiKey: process.env.COPILOTKIT_API_KEY!,
 *   tenantId: process.env.COPILOTKIT_TENANT_ID!,
 * });
 *
 * const runtime = new CopilotRuntime({
 *   agents,
 *   intelligenceSdk: sdk,
 * });
 * ```
 */

export interface CopilotIntelligenceSdkConfig {
  /** Base URL of the intelligence platform API, e.g. "https://api.copilotkit.ai" */
  apiUrl: string;
  /** Intelligence websocket base URL. Runner and client socket URLs are derived from this. */
  wsUrl: string;
  /** API key for authenticating with the intelligence platform */
  apiKey: string;
  /** Tenant identifier used for self-hosted Intelligence instances */
  tenantId: string;
}

export interface ThreadSummary {
  id: string;
  name: string | null;
  lastRunAt?: string;
  lastUpdatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  agentId?: string;
  createdById?: string;
  tenantId?: string;
}

export interface ListThreadsResponse {
  threads: ThreadSummary[];
  joinCode: string;
  joinToken?: string;
}

export interface UpdateThreadRequest {
  name?: string;
  [key: string]: unknown;
}

export interface CreateThreadRequest {
  threadId: string;
  userId: string;
  agentId: string;
  name?: string;
}

export interface ThreadConnectionResponse {
  joinToken: string;
  joinCode?: string;
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

export interface ThreadMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
  }>;
  toolCallId?: string;
}

export interface ThreadMessagesResponse {
  messages: ThreadMessage[];
}

export interface AcquireThreadLockRequest {
  threadId: string;
  runId: string;
}

interface ThreadEnvelope {
  thread: ThreadSummary;
}

export class CopilotIntelligenceSdk {
  private apiUrl: string;
  private runnerWsUrl: string;
  private clientWsUrl: string;
  private apiKey: string;
  private tenantId: string;

  constructor(config: CopilotIntelligenceSdkConfig) {
    const intelligenceWsUrl = normalizeIntelligenceWsUrl(config.wsUrl);

    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.runnerWsUrl = deriveRunnerWsUrl(intelligenceWsUrl);
    this.clientWsUrl = deriveClientWsUrl(intelligenceWsUrl);
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  getRunnerWsUrl(): string {
    return this.runnerWsUrl;
  }

  getClientWsUrl(): string {
    return this.clientWsUrl;
  }

  getWsUrl(): string {
    return this.clientWsUrl;
  }

  getTenantId(): string {
    return this.tenantId;
  }

  getRunnerAuthToken(): string {
    return this.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Tenant-Id": this.tenantId,
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
      throw new Error(
        `Intelligence platform error ${response.status}: ${text || response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async listThreads(params: {
    userId: string;
    agentId: string;
  }): Promise<ListThreadsResponse> {
    const query = new URLSearchParams(params).toString();
    return this.request<ListThreadsResponse>("GET", `/api/threads?${query}`);
  }

  async updateThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
    updates: UpdateThreadRequest;
  }): Promise<ThreadSummary> {
    const response = await this.request<ThreadEnvelope>(
      "PATCH",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
      {
        userId: params.userId,
        agentId: params.agentId,
        ...params.updates,
      },
    );
    return response.thread;
  }

  async createThread(params: CreateThreadRequest): Promise<ThreadSummary> {
    const response = await this.request<ThreadEnvelope>(
      "POST",
      `/api/threads`,
      {
        threadId: params.threadId,
        userId: params.userId,
        agentId: params.agentId,
        ...(params.name !== undefined ? { name: params.name } : {}),
      },
    );
    return response.thread;
  }

  async getThread(params: { threadId: string }): Promise<ThreadSummary> {
    const response = await this.request<ThreadEnvelope>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
    );
    return response.thread;
  }

  async getThreadMessages(params: {
    threadId: string;
  }): Promise<ThreadMessagesResponse> {
    return this.request<ThreadMessagesResponse>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}/messages`,
    );
  }

  async archiveThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
  }): Promise<void> {
    await this.request<void>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/archive`,
      { userId: params.userId, agentId: params.agentId },
    );
  }

  async deleteThread(params: {
    threadId: string;
    userId: string;
    agentId: string;
  }): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
      { userId: params.userId, agentId: params.agentId },
    );
  }

  async acquireThreadLock(
    params: AcquireThreadLockRequest,
  ): Promise<ThreadConnectionResponse> {
    return this.request<ThreadConnectionResponse>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
      { runId: params.runId },
    );
  }

  async getActiveJoinCode(params: {
    threadId: string;
  }): Promise<ThreadConnectionResponse> {
    return this.request<ThreadConnectionResponse>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}/join-code`,
    );
  }

  async connectThread(params: {
    threadId: string;
    lastSeenEventId?: string | null;
  }): Promise<ConnectThreadResponse> {
    const url = `${this.apiUrl}/api/threads/${encodeURIComponent(params.threadId)}/connect`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Tenant-Id": this.tenantId,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(params.lastSeenEventId !== undefined
          ? { lastSeenEventId: params.lastSeenEventId }
          : {}),
      }),
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body: text, path: `/api/threads/${params.threadId}/connect` },
        "Intelligence platform request failed",
      );
      throw new Error(
        `Intelligence platform error ${response.status}: ${text || response.statusText}`,
      );
    }

    return response.json() as Promise<ConnectThreadResponse>;
  }
}

export {
  CopilotIntelligenceSdk as IntelligencePlatformClient,
  type CopilotIntelligenceSdkConfig as IntelligencePlatformConfig,
};

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
