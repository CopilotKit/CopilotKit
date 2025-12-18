import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { logger, RuntimeInfo, AgentDescription } from "@copilotkitnext/shared";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreErrorCode, CopilotKitCoreRuntimeConnectionStatus, CopilotKitCoreFriendsAccess } from "./core";
import { CopilotRuntimeTransport } from "../types";

export interface CopilotKitCoreAddAgentParams {
  id: string;
  agent: AbstractAgent;
}

/**
 * Manages agent registration, lifecycle, and runtime connectivity for CopilotKitCore.
 * Handles both local development agents and remote runtime agents.
 */
export class AgentRegistry {
  private _agents: Record<string, AbstractAgent> = {};
  private localAgents: Record<string, AbstractAgent> = {};
  private remoteAgents: Record<string, AbstractAgent> = {};

  private _runtimeUrl?: string;
  private _runtimeVersion?: string;
  private _runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus =
    CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  private _runtimeTransport: CopilotRuntimeTransport = "rest";

  constructor(private core: CopilotKitCore) {}

  /**
   * Get all agents as a readonly record
   */
  get agents(): Readonly<Record<string, AbstractAgent>> {
    return this._agents;
  }

  get runtimeUrl(): string | undefined {
    return this._runtimeUrl;
  }

  get runtimeVersion(): string | undefined {
    return this._runtimeVersion;
  }

  get runtimeConnectionStatus(): CopilotKitCoreRuntimeConnectionStatus {
    return this._runtimeConnectionStatus;
  }

  get runtimeTransport(): CopilotRuntimeTransport {
    return this._runtimeTransport;
  }

  /**
   * Initialize agents from configuration
   */
  initialize(agents: Record<string, AbstractAgent>): void {
    this.localAgents = this.assignAgentIds(agents);
    this.applyHeadersToAgents(this.localAgents);
    this._agents = this.localAgents;
  }

  /**
   * Set the runtime URL and update connection
   */
  setRuntimeUrl(runtimeUrl: string | undefined): void {
    const normalizedRuntimeUrl = runtimeUrl ? runtimeUrl.replace(/\/$/, "") : undefined;

    if (this._runtimeUrl === normalizedRuntimeUrl) {
      return;
    }

    this._runtimeUrl = normalizedRuntimeUrl;
    void this.updateRuntimeConnection();
  }

  setRuntimeTransport(runtimeTransport: CopilotRuntimeTransport): void {
    if (this._runtimeTransport === runtimeTransport) {
      return;
    }

    this._runtimeTransport = runtimeTransport;
    void this.updateRuntimeConnection();
  }

  /**
   * Set all agents at once (for development use)
   */
  setAgents__unsafe_dev_only(agents: Record<string, AbstractAgent>): void {
    // Validate all agents before making any changes
    Object.entries(agents).forEach(([id, agent]) => {
      if (agent) {
        this.validateAndAssignAgentId(id, agent);
      }
    });
    this.localAgents = agents;
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    this.applyHeadersToAgents(this._agents);
    void this.notifyAgentsChanged();
  }

  /**
   * Add a single agent (for development use)
   */
  addAgent__unsafe_dev_only({ id, agent }: CopilotKitCoreAddAgentParams): void {
    this.validateAndAssignAgentId(id, agent);
    this.localAgents[id] = agent;
    this.applyHeadersToAgent(agent);
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    void this.notifyAgentsChanged();
  }

  /**
   * Remove an agent by ID (for development use)
   */
  removeAgent__unsafe_dev_only(id: string): void {
    delete this.localAgents[id];
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    void this.notifyAgentsChanged();
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AbstractAgent | undefined {
    if (id in this._agents) {
      return this._agents[id] as AbstractAgent;
    }

    // Silently return undefined if we're still loading runtime agents
    if (
      this.runtimeUrl !== undefined &&
      (this.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        this.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      return undefined;
    }

    console.warn(`Agent ${id} not found`);
    return undefined;
  }

  /**
   * Apply current headers to an agent
   */
  applyHeadersToAgent(agent: AbstractAgent): void {
    if (agent instanceof HttpAgent) {
      agent.headers = { ...(this.core as unknown as CopilotKitCoreFriendsAccess).headers };
    }
  }

  /**
   * Apply current headers to all agents
   */
  applyHeadersToAgents(agents: Record<string, AbstractAgent>): void {
    Object.values(agents).forEach((agent) => {
      this.applyHeadersToAgent(agent);
    });
  }

  /**
   * Update runtime connection and fetch remote agents
   */
  private async updateRuntimeConnection(): Promise<void> {
    // Skip fetching on the server (SSR)
    if (typeof window === 'undefined') {
      return;
    }

    if (!this.runtimeUrl) {
      this._runtimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Disconnected;
      this._runtimeVersion = undefined;
      this.remoteAgents = {};
      this._agents = this.localAgents;

      await this.notifyRuntimeStatusChanged(CopilotKitCoreRuntimeConnectionStatus.Disconnected);
      await this.notifyAgentsChanged();
      return;
    }

    this._runtimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Connecting;
    await this.notifyRuntimeStatusChanged(CopilotKitCoreRuntimeConnectionStatus.Connecting);

    try {
      const runtimeInfoResponse = await this.fetchRuntimeInfo();
      const {
        version,
        ...runtimeInfo
      }: {
        agents: Record<string, AgentDescription>;
        version: string;
      } = runtimeInfoResponse;

      const agents: Record<string, AbstractAgent> = Object.fromEntries(
        Object.entries(runtimeInfo.agents).map(([id, { description }]) => {
          const agent = new ProxiedCopilotRuntimeAgent({
            runtimeUrl: this.runtimeUrl,
            agentId: id, // Runtime agents always have their ID set correctly
            description: description,
            transport: this._runtimeTransport,
          });
          this.applyHeadersToAgent(agent);
          return [id, agent];
        }),
      );

      this.remoteAgents = agents;
      this._agents = { ...this.localAgents, ...this.remoteAgents };
      this._runtimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Connected;
      this._runtimeVersion = version;

      await this.notifyRuntimeStatusChanged(CopilotKitCoreRuntimeConnectionStatus.Connected);
      await this.notifyAgentsChanged();
    } catch (error) {
      this._runtimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Error;
      this._runtimeVersion = undefined;
      this.remoteAgents = {};
      this._agents = this.localAgents;

      await this.notifyRuntimeStatusChanged(CopilotKitCoreRuntimeConnectionStatus.Error);
      await this.notifyAgentsChanged();

      const message = error instanceof Error ? error.message : JSON.stringify(error);
      logger.warn(`Failed to load runtime info (${this.runtimeUrl}/info): ${message}`);
      const runtimeError = error instanceof Error ? error : new Error(String(error));
      await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
        error: runtimeError,
        code: CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
        context: {
          runtimeUrl: this.runtimeUrl,
        },
      });
    }
  }

  private async fetchRuntimeInfo(): Promise<RuntimeInfo> {
    if (!this.runtimeUrl) {
      throw new Error("Runtime URL is not set");
    }

    const baseHeaders = (this.core as unknown as CopilotKitCoreFriendsAccess).headers;
    const headers: Record<string, string> = {
      ...baseHeaders,
    };

    if (this._runtimeTransport === "single") {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const response = await fetch(this.runtimeUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ method: "info" }),
      });
      if ("ok" in response && !(response as Response).ok) {
        throw new Error(`Runtime info request failed with status ${response.status}`);
      }
      return (await response.json()) as RuntimeInfo;
    }

    const response = await fetch(`${this.runtimeUrl}/info`, {
      headers,
    });
    if ("ok" in response && !(response as Response).ok) {
      throw new Error(`Runtime info request failed with status ${response.status}`);
    }
    return (await response.json()) as RuntimeInfo;
  }

  /**
   * Assign agent IDs to a record of agents
   */
  private assignAgentIds(agents: Record<string, AbstractAgent>): Record<string, AbstractAgent> {
    Object.entries(agents).forEach(([id, agent]) => {
      if (agent) {
        this.validateAndAssignAgentId(id, agent);
      }
    });
    return agents;
  }

  /**
   * Validate and assign an agent ID
   */
  private validateAndAssignAgentId(registrationId: string, agent: AbstractAgent): void {
    if (agent.agentId && agent.agentId !== registrationId) {
      throw new Error(
        `Agent registration mismatch: Agent with ID "${agent.agentId}" cannot be registered under key "${registrationId}". ` +
          `The agent ID must match the registration key or be undefined.`,
      );
    }
    if (!agent.agentId) {
      agent.agentId = registrationId;
    }
  }

  /**
   * Notify subscribers of runtime status changes
   */
  private async notifyRuntimeStatusChanged(status: CopilotKitCoreRuntimeConnectionStatus): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this.core,
          status,
        }),
      "Error in CopilotKitCore subscriber (onRuntimeConnectionStatusChanged):",
    );
  }

  /**
   * Notify subscribers of agent changes
   */
  private async notifyAgentsChanged(): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: this.core,
          agents: this._agents,
        }),
      "Subscriber onAgentsChanged error:",
    );
  }
}
