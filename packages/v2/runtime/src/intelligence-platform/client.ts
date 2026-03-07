import { logger } from "@copilotkitnext/shared";

/**
 * Client for the CopilotKit Intelligence Platform REST API.
 *
 * Construct the client once and pass it to any consumers that need it
 * (e.g. `CopilotRuntime`, `IntelligenceAgentRunner`):
 *
 * ```ts
 * import { IntelligencePlatformClient } from "@copilotkitnext/runtime";
 * import { CopilotRuntime, IntelligenceAgentRunner } from "@copilotkitnext/runtime";
 *
 * const platform = new IntelligencePlatformClient({
 *   apiUrl: "https://api.copilotkit.ai",
 *   apiKey: process.env.COPILOTKIT_API_KEY!,
 * });
 *
 * const runtime = new CopilotRuntime({
 *   agents,
 *   intelligencePlatform: platform,
 *   runner: new IntelligenceAgentRunner({
 *     url: "wss://api.copilotkit.ai/socket",
 *   }),
 * });
 * ```
 */

export interface IntelligencePlatformConfig {
  /** Base URL of the intelligence platform API, e.g. "https://api.copilotkit.ai" */
  apiUrl: string;
  /** API key for authenticating with the intelligence platform */
  apiKey: string;
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

interface ThreadEnvelope {
  thread: ThreadSummary;
}

export class IntelligencePlatformClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(config: IntelligencePlatformConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
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
    const response = await this.request<ThreadEnvelope>("POST", `/api/threads`, {
      threadId: params.threadId,
      userId: params.userId,
      agentId: params.agentId,
      ...(params.name !== undefined ? { name: params.name } : {}),
    });
    return response.thread;
  }

  async getThread(params: { threadId: string }): Promise<ThreadSummary> {
    const response = await this.request<ThreadEnvelope>(
      "GET",
      `/api/threads/${encodeURIComponent(params.threadId)}`,
    );
    return response.thread;
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

  async acquireThreadLock(params: {
    threadId: string;
  }): Promise<ThreadConnectionResponse> {
    return this.request<ThreadConnectionResponse>(
      "POST",
      `/api/threads/${encodeURIComponent(params.threadId)}/lock`,
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
}
