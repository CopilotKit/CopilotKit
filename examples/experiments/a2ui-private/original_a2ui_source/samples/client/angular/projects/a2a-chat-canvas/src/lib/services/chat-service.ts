/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { AgentCard, SendMessageSuccessResponse } from '@a2a-js/sdk';
import { PART_RESOLVERS } from '@a2a_chat_canvas/a2a-renderer/tokens';
import { A2A_SERVICE } from '@a2a_chat_canvas/interfaces/a2a-service';
import { UiAgent, UiMessage, UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { extractA2aPartsFromResponse } from '@a2a_chat_canvas/utils/a2a';
import { extractA2uiDataParts } from '@a2a_chat_canvas/utils/a2ui';
import { convertPartToUiMessageContent } from '@a2a_chat_canvas/utils/ui-message-utils';
import { ModelProcessor, DispatchedEvent } from '@a2ui/angular';
import { inject, Injectable, resource, signal } from '@angular/core';
import { v4 as uuid } from 'uuid';

/**
 * Service responsible for managing chat interactions, including sending messages,
 * processing responses, and maintaining chat context.
 */
@Injectable({
  providedIn: 'root',
})
export class ChatService {
  /** Service for interacting with the A2A (Agent-to-Agent) API. */
  private readonly a2aService = inject(A2A_SERVICE);
  /** Processor for handling A2UI messages and managing UI state. */
  private readonly a2uiModelProcessor = inject(ModelProcessor);
  /** Resolvers for converting A2A parts to UI message content. */
  private readonly partResolvers = inject(PART_RESOLVERS);

  /** Resource for fetching the agent card information. */
  private readonly agentCardResource = resource({
    loader: async () => {
      let agentCard: AgentCard | null = null;
      try {
        agentCard = await this.a2aService.getAgentCard();
      } catch (e) {
        console.error('Failed to fetch agent card: ', e);
      }
      return agentCard;
    },
  });
  /** Signal containing the fetched agent card, or null if not loaded. */
  private readonly agentCard = this.agentCardResource.value;
  /** Signal holding the current chat context ID. */
  private readonly contextId = signal<string | undefined>(undefined);
  /** Controller to abort ongoing A2A stream requests. */
  private abortController: AbortController | null = null;

  /** Signal holding the array of UI messages in the chat history. */
  readonly history = signal<UiMessage[]>([]);
  /** Signal indicating whether an A2A stream is currently open. */
  readonly isA2aStreamOpen = signal(false);
  /** Signal holding the current A2UI surfaces managed by the A2UI ModelProcessor. */
  readonly a2uiSurfaces = signal(new Map(this.a2uiModelProcessor.getSurfaces()));

  /**
   * Subscribes to events dispatched from the A2UI ModelProcessor.
   * This is a TEMPORARY handler for user actions. Clients should override this
   * to implement their own event handling logic, potentially dispatching
   * events to their own state management or making different API calls.
   */
  constructor() {
    this.a2uiModelProcessor.events.subscribe(async (event: DispatchedEvent) => {
      try {
        // TODO: Replace this with a more robust event handling mechanism.
        // Currently, it just sends the event message back to the agent.
        await this.sendMessage(JSON.stringify(event.message));
        event.completion.next([]);
        event.completion.complete();
      } catch (err) {
        event.completion.error(err);
      }
    });
  }

  /**
   * Sends a message to the A2A service and handles the response.
   * Adds optimistic user and pending agent messages to the history.
   *
   * @param text The text message to send.
   */
  async sendMessage(text: string) {
    this.addUserAndPendingAgentMessages(text);
    this.isA2aStreamOpen.set(true);

    try {
      this.abortController = new AbortController();
      const a2aResponse = await this.a2aService.sendMessage(
        [{ kind: 'text', text }],
        this.abortController.signal,
      );
      this.handleSuccess(a2aResponse);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isA2aStreamOpen.set(false);
      this.abortController = null;
    }
  }

  /**
   * Cancels the ongoing A2A stream.
   */
  async cancelOngoingStream(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Adds a new user message and a pending agent message to the history.
   * Used for optimistic UI updates before the API response is received.
   *
   * @param text The user's message text.
   */
  private addUserAndPendingAgentMessages(text: string) {
    const now = new Date().toISOString();
    const userMessage = this.createNewUserMessage(text, now);
    const agentMessage = this.createPendingAgentMessage(now);
    this.history.update((curr) => [...curr, userMessage, agentMessage]);
  }

  /**
   * Handles a successful response from the A2A service.
   * Updates the pending agent message with the response content and processes A2UI data.
   *
   * @param response The success response from the A2A service.
   */
  private handleSuccess(response: SendMessageSuccessResponse) {
    const agentResponseParts = extractA2aPartsFromResponse(response);
    const newContents = agentResponseParts.map(
      (part): UiMessageContent => convertPartToUiMessageContent(part, this.partResolvers),
    );

    this.updateLastMessage((msg) => ({
      ...msg,
      role: this.createRole(response),
      contents: [...msg.contents, ...newContents],
      status: 'completed',
      lastUpdated: new Date().toISOString(),
    }));

    // Let A2UI Renderer process the A2UI data parts in agent response.
    this.a2uiModelProcessor.processMessages(extractA2uiDataParts(agentResponseParts));
    this.a2uiSurfaces.set(new Map(this.a2uiModelProcessor.getSurfaces()));
  }

  /**
   * Handles errors that occur during the message sending process.
   * Updates the pending agent message with an error message.
   *
   * @param error The error object or message.
   */
  private handleError(error: unknown) {
    let errorMessage = 'Something went wrong: ' + error;
    if (error instanceof Error && error.name === 'AbortError') {
      errorMessage = 'You cancelled the response.';
    }

    const errorContent: UiMessageContent = {
      type: 'ui_message_content',
      id: uuid(),
      data: {
        kind: 'text',
        text: errorMessage,
      },
      variant: 'default_text_part',
    };

    this.updateLastMessage((msg) => ({
      ...msg,
      contents: [...msg.contents, errorContent],
      status: 'completed',
      lastUpdated: new Date().toISOString(),
    }));
  }

  /**
   * Updates the last message in the history using the provided updater function.
   * Ensures immutability for OnPush change detection.
   *
   * @param updater A function that takes the current last message and returns the updated message.
   */
  private updateLastMessage(updater: (msg: UiMessage) => UiMessage) {
    this.history.update((history) => {
      if (history.length === 0) return history;
      // New reference of the same object for OnPush ChangeDetectionStrategy.
      const lastMessage = history[history.length - 1];
      return [...history.slice(0, -1), updater(lastMessage)];
    });
  }

  /**
   * Creates a new user message object.
   *
   * @param text The text content of the message.
   * @param nowTimestamp The timestamp for the message creation.
   * @returns A new UiMessage object representing the user's message.
   */
  private createNewUserMessage(text: string, nowTimestamp: string): UiMessage {
    return {
      type: 'ui_message',
      id: uuid(),
      contextId: this.contextId() ?? '',
      role: {
        type: 'ui_user',
      },
      contents: [
        {
          type: 'ui_message_content',
          id: uuid(),
          data: {
            kind: 'text',
            text,
          },
          variant: 'default_text_part',
        },
      ],
      status: 'pending',
      created: nowTimestamp,
      lastUpdated: nowTimestamp,
    };
  }

  /**
   * Creates a new pending agent message object.
   *
   * @param nowTimestamp The timestamp for the message creation.
   * @returns A new UiMessage object representing the pending agent message.
   */
  private createPendingAgentMessage(nowTimestamp: string): UiMessage {
    return {
      type: 'ui_message',
      id: uuid(),
      contextId: this.contextId() ?? '',
      role: this.createRole(),
      contents: [],
      status: 'pending',
      created: nowTimestamp,
      lastUpdated: nowTimestamp,
    };
  }

  /**
   * Creates the agent role based on the agent card and the message response if available.
   *
   * @param response The reponse message received from the agent.
   * @returns A new UiAgent object representing the agent that the user is chatting with.
   */
  private createRole(response?: SendMessageSuccessResponse): UiAgent {
    const rootagentRole: UiAgent = {
      type: 'ui_agent',
      name: this.agentCard()?.name ?? 'Agent',
      iconUrl: this.agentCard()?.iconUrl ?? 'gemini-color.svg',
    };

    const subagentCard = response?.result?.metadata?.['a2a_subagent'];
    if (!subagentCard) {
      return rootagentRole;
    }
    const agentRole: UiAgent = {
      ...rootagentRole,
      subagentName: (subagentCard as AgentCard).name,
    }

    return agentRole;
  }
}
