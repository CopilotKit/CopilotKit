import { AbstractAgent, Message, Tool, Context } from "@ag-ui/client";
import { randomUUID, partialJSONParse } from "@copilotkitnext/shared";
import type { CopilotKitCore } from "./core";
import type { CopilotKitCoreGetSuggestionsResult } from "./core";
import { CopilotKitCoreFriendsAccess } from "./core";
import { DynamicSuggestionsConfig, StaticSuggestionsConfig, Suggestion, SuggestionsConfig } from "../types";

/**
 * Manages suggestion generation, streaming, and lifecycle for CopilotKitCore.
 * Handles both dynamic (AI-generated) and static suggestions.
 */
export class SuggestionEngine {
  private _suggestionsConfig: Record<string, SuggestionsConfig> = {};
  private _suggestions: Record<string, Record<string, Suggestion[]>> = {};
  private _runningSuggestions: Record<string, AbstractAgent[]> = {};

  constructor(private core: CopilotKitCore) {}

  /**
   * Initialize with suggestion configs
   */
  initialize(suggestionsConfig: SuggestionsConfig[]): void {
    for (const config of suggestionsConfig) {
      this._suggestionsConfig[randomUUID()] = config;
    }
  }

  /**
   * Add a suggestion configuration
   * @returns The ID of the created config
   */
  addSuggestionsConfig(config: SuggestionsConfig): string {
    const id = randomUUID();
    this._suggestionsConfig[id] = config;
    void this.notifySuggestionsConfigChanged();
    return id;
  }

  /**
   * Remove a suggestion configuration by ID
   */
  removeSuggestionsConfig(id: string): void {
    delete this._suggestionsConfig[id];
    void this.notifySuggestionsConfigChanged();
  }

  /**
   * Reload suggestions for a specific agent
   * This triggers generation of new suggestions based on current configs
   */
  public reloadSuggestions(agentId: string): void {
    this.clearSuggestions(agentId);

    // Get agent to check message count for availability filtering
    const agent = (this.core as unknown as CopilotKitCoreFriendsAccess).getAgent(agentId);
    if (!agent) {
      return;
    }

    const messageCount = agent.messages?.length ?? 0;
    let hasAnySuggestions = false;

    for (const config of Object.values(this._suggestionsConfig)) {
      // Check if config applies to this agent
      if (
        config.consumerAgentId !== undefined &&
        config.consumerAgentId !== "*" &&
        config.consumerAgentId !== agentId
      ) {
        continue;
      }

      // Check availability based on message count
      if (!this.shouldShowSuggestions(config, messageCount)) {
        continue;
      }

      const suggestionId = randomUUID();

      if (isDynamicSuggestionsConfig(config)) {
        if (!hasAnySuggestions) {
          hasAnySuggestions = true;
          void this.notifySuggestionsStartedLoading(agentId);
        }
        void this.generateSuggestions(suggestionId, config, agentId);
      } else if (isStaticSuggestionsConfig(config)) {
        this.addStaticSuggestions(suggestionId, config, agentId);
      }
    }
  }

  /**
   * Clear all suggestions for a specific agent
   */
  public clearSuggestions(agentId: string): void {
    const runningAgents = this._runningSuggestions[agentId];
    if (runningAgents) {
      for (const agent of runningAgents) {
        agent.abortRun();
      }
      delete this._runningSuggestions[agentId];
    }
    this._suggestions[agentId] = {};

    void this.notifySuggestionsChanged(agentId, []);
  }

  /**
   * Get current suggestions for an agent
   */
  public getSuggestions(agentId: string): CopilotKitCoreGetSuggestionsResult {
    const suggestions = Object.values(this._suggestions[agentId] ?? {}).flat();
    const isLoading = (this._runningSuggestions[agentId]?.length ?? 0) > 0;
    return { suggestions, isLoading };
  }

  /**
   * Generate suggestions using a provider agent
   */
  private async generateSuggestions(
    suggestionId: string,
    config: DynamicSuggestionsConfig,
    consumerAgentId: string,
  ): Promise<void> {
    let agent: AbstractAgent | undefined = undefined;
    try {
      const suggestionsProviderAgent = (this.core as unknown as CopilotKitCoreFriendsAccess).getAgent(
        config.providerAgentId ?? "default",
      );
      if (!suggestionsProviderAgent) {
        throw new Error(`Suggestions provider agent not found: ${config.providerAgentId}`);
      }
      const suggestionsConsumerAgent = (this.core as unknown as CopilotKitCoreFriendsAccess).getAgent(consumerAgentId);
      if (!suggestionsConsumerAgent) {
        throw new Error(`Suggestions consumer agent not found: ${consumerAgentId}`);
      }

      const clonedAgent: AbstractAgent = suggestionsProviderAgent.clone();
      agent = clonedAgent;
      //agent.agentId = suggestionId;
      agent.threadId = suggestionId;
      agent.messages = JSON.parse(JSON.stringify(suggestionsConsumerAgent.messages));
      agent.state = JSON.parse(JSON.stringify(suggestionsConsumerAgent.state));

      // Initialize suggestion storage for this agent/suggestion combo
      this._suggestions[consumerAgentId] = {
        ...(this._suggestions[consumerAgentId] ?? {}),
        [suggestionId]: [],
      };
      this._runningSuggestions[consumerAgentId] = [...(this._runningSuggestions[consumerAgentId] ?? []), agent];

      agent.addMessage({
        id: suggestionId,
        role: "user",
        content: [
          `Suggest what the user could say next. Provide clear, highly relevant suggestions by calling the \`copilotkitSuggest\` tool.`,
          `Provide at least ${config.minSuggestions ?? 1} and at most ${config.maxSuggestions ?? 3} suggestions.`,
          `The user has the following tools available: ${JSON.stringify((this.core as unknown as CopilotKitCoreFriendsAccess).buildFrontendTools(consumerAgentId))}.`,
          ` ${config.instructions}`,
        ].join("\n"),
      });

      await agent.runAgent(
        {
          context: Object.values((this.core as unknown as CopilotKitCoreFriendsAccess).context),
          forwardedProps: {
            ...(this.core as unknown as CopilotKitCoreFriendsAccess).properties,
            toolChoice: { type: "function", function: { name: "copilotkitSuggest" } },
          },
          tools: [SUGGEST_TOOL],
        },
        {
          onMessagesChanged: ({ messages }: { messages: Message[] }) => {
            this.extractSuggestions(messages, suggestionId, consumerAgentId, true);
          },
        },
      );
    } catch (error) {
      console.warn("Error generating suggestions:", error);
    } finally {
      // Finalize suggestions by marking them as no longer loading
      this.finalizeSuggestions(suggestionId, consumerAgentId);

      // Remove this agent from running suggestions
      const runningAgents = this._runningSuggestions[consumerAgentId];
      if (agent && runningAgents) {
        const filteredAgents = runningAgents.filter((a) => a !== agent);
        this._runningSuggestions[consumerAgentId] = filteredAgents;

        // If no more suggestions are running, emit loading end event
        if (filteredAgents.length === 0) {
          delete this._runningSuggestions[consumerAgentId];
          await this.notifySuggestionsFinishedLoading(consumerAgentId);
        }
      }
    }
  }

  /**
   * Finalize suggestions by marking them as no longer loading
   */
  private finalizeSuggestions(suggestionId: string, consumerAgentId: string): void {
    const agentSuggestions = this._suggestions[consumerAgentId];
    const currentSuggestions = agentSuggestions?.[suggestionId];

    if (agentSuggestions && currentSuggestions && currentSuggestions.length > 0) {
      // Filter out empty suggestions and mark remaining as no longer loading
      const finalizedSuggestions = currentSuggestions
        .filter((suggestion) => suggestion.title !== "" || suggestion.message !== "")
        .map((suggestion) => ({
          ...suggestion,
          isLoading: false,
        }));

      if (finalizedSuggestions.length > 0) {
        agentSuggestions[suggestionId] = finalizedSuggestions;
      } else {
        delete agentSuggestions[suggestionId];
      }

      // Get all aggregated suggestions for this agent
      const allSuggestions = Object.values(this._suggestions[consumerAgentId] ?? {}).flat();

      void this.notifySuggestionsChanged(consumerAgentId, allSuggestions, "finalized");
    }
  }

  /**
   * Extract suggestions from messages (called during streaming)
   */
  extractSuggestions(messages: Message[], suggestionId: string, consumerAgentId: string, isRunning: boolean): void {
    const idx = messages.findIndex((message) => message.id === suggestionId);
    if (idx == -1) {
      return;
    }

    const suggestions: Suggestion[] = [];
    const newMessages = messages.slice(idx + 1);

    for (const message of newMessages) {
      if (message.role === "assistant" && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          if (toolCall.function.name === "copilotkitSuggest") {
            // Join all argument chunks into a single string for parsing
            // arguments can be either a string or an array of strings
            const fullArgs = Array.isArray(toolCall.function.arguments)
              ? toolCall.function.arguments.join("")
              : toolCall.function.arguments;
            const parsed = partialJSONParse(fullArgs);
            if (parsed && typeof parsed === "object" && "suggestions" in parsed) {
              const parsedSuggestions = (parsed as any).suggestions;
              if (Array.isArray(parsedSuggestions)) {
                for (const item of parsedSuggestions) {
                  if (item && typeof item === "object" && "title" in item) {
                    suggestions.push({
                      title: item.title ?? "",
                      message: item.message ?? "",
                      isLoading: false, // Will be set correctly below
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Set isLoading for the last suggestion if still running
    if (isRunning && suggestions.length > 0) {
      suggestions[suggestions.length - 1]!.isLoading = true;
    }

    const agentSuggestions = this._suggestions[consumerAgentId];
    if (agentSuggestions) {
      agentSuggestions[suggestionId] = suggestions;

      // Get all aggregated suggestions for this agent
      const allSuggestions = Object.values(this._suggestions[consumerAgentId] ?? {}).flat();

      void this.notifySuggestionsChanged(consumerAgentId, allSuggestions, "suggestions changed");
    }
  }

  /**
   * Notify subscribers of suggestions config changes
   */
  private async notifySuggestionsConfigChanged(): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onSuggestionsConfigChanged?.({
          copilotkit: this.core,
          suggestionsConfig: this._suggestionsConfig,
        }),
      "Subscriber onSuggestionsConfigChanged error:",
    );
  }

  /**
   * Notify subscribers of suggestions changes
   */
  private async notifySuggestionsChanged(
    agentId: string,
    suggestions: Suggestion[],
    context: string = "",
  ): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onSuggestionsChanged?.({
          copilotkit: this.core,
          agentId,
          suggestions,
        }),
      `Subscriber onSuggestionsChanged error: ${context}`,
    );
  }

  /**
   * Notify subscribers that suggestions started loading
   */
  private async notifySuggestionsStartedLoading(agentId: string): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onSuggestionsStartedLoading?.({
          copilotkit: this.core,
          agentId,
        }),
      "Subscriber onSuggestionsStartedLoading error:",
    );
  }

  /**
   * Notify subscribers that suggestions finished loading
   */
  private async notifySuggestionsFinishedLoading(agentId: string): Promise<void> {
    await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onSuggestionsFinishedLoading?.({
          copilotkit: this.core,
          agentId,
        }),
      "Subscriber onSuggestionsFinishedLoading error:",
    );
  }

  /**
   * Check if suggestions should be shown based on availability and message count
   */
  private shouldShowSuggestions(config: SuggestionsConfig, messageCount: number): boolean {
    const availability = config.available;

    // Default behavior if no availability specified
    if (!availability) {
      if (isDynamicSuggestionsConfig(config)) {
        return messageCount > 0; // Default: after-first-message
      } else {
        return messageCount === 0; // Default: before-first-message
      }
    }

    switch (availability) {
      case "disabled":
        return false;
      case "before-first-message":
        return messageCount === 0;
      case "after-first-message":
        return messageCount > 0;
      case "always":
        return true;
      default:
        return false;
    }
  }

  /**
   * Add static suggestions directly without AI generation
   */
  private addStaticSuggestions(suggestionId: string, config: StaticSuggestionsConfig, consumerAgentId: string): void {
    // Mark all as not loading since they're static
    const suggestions = config.suggestions.map((s) => ({
      ...s,
      isLoading: false,
    }));

    // Store suggestions
    this._suggestions[consumerAgentId] = {
      ...(this._suggestions[consumerAgentId] ?? {}),
      [suggestionId]: suggestions,
    };

    // Notify subscribers
    const allSuggestions = Object.values(this._suggestions[consumerAgentId] ?? {}).flat();

    void this.notifySuggestionsChanged(consumerAgentId, allSuggestions, "static suggestions added");
  }
}

/**
 * Type guard for dynamic suggestions config
 */
function isDynamicSuggestionsConfig(config: SuggestionsConfig): config is DynamicSuggestionsConfig {
  return "instructions" in config;
}

/**
 * Type guard for static suggestions config
 */
function isStaticSuggestionsConfig(config: SuggestionsConfig): config is StaticSuggestionsConfig {
  return "suggestions" in config;
}

/**
 * The tool definition for AI-generated suggestions
 */
const SUGGEST_TOOL: Tool = {
  name: "copilotkitSuggest",
  description: "Suggest what the user could say next",
  parameters: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        description: "List of suggestions shown to the user as buttons.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title of the suggestion. This is shown as a button and should be short.",
            },
            message: {
              type: "string",
              description:
                "The message to send when the suggestion is clicked. This should be a clear, complete sentence " +
                "and will be sent as an instruction to the AI.",
            },
          },
          required: ["title", "message"],
        },
      },
    },
    required: ["suggestions"],
  },
};
