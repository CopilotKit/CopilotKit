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

import { A2aRenderer } from '@a2a_chat_canvas/a2a-renderer/a2a-renderer';
import { AgentHeader } from '@a2a_chat_canvas/components/chat/agent-header/agent-header';
import { ChatService } from '@a2a_chat_canvas/services/chat-service';
import { Role, UiAgent, UiMessage, UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { isAgentThought } from '@a2a_chat_canvas/utils/a2a';
import { isA2aPart } from '@a2a_chat_canvas/utils/type-guards';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

/** UI message component. */
@Component({
  selector: 'message',
  templateUrl: './message.html',
  styleUrl: './message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgentHeader, A2aRenderer],
})
export class Message {
  /** The UI message to display. */
  readonly message = input.required<UiMessage>();

  /** Service for managing chat interactions. */
  private readonly chatService = inject(ChatService);

  protected getAgentName(role: UiAgent) {
    const rootagentName = role.name;
    return role.subagentName ? `${rootagentName} + ${role.subagentName}` : rootagentName;
  }

  /** Agent thought contents. */
  protected readonly agentThoughts = computed(() =>
    this.message().contents.filter((content) => containsAgentThought(content)),
  );
  /** Agent non-thought contents. */
  protected readonly messageContents = computed(() =>
    this.message().contents.filter((content) => !containsAgentThought(content)),
  );
  /** Whether the message is pending. */
  protected readonly showProgressIndicator = computed(() => {
    return this.message().status === 'pending';
  });
  /** A2UI surfaces in the conversation. */
  protected readonly surfaces = computed(() => this.chatService.a2uiSurfaces());

  /**
   * Type guard to check if the role is of type UiAgent.
   * @param role The role to check.
   * @returns True if the role is a UiAgent.
   */
  protected isRoleAgent(role: Role): role is UiAgent {
    return role.type === 'ui_agent';
  }
}

/**
 * Checks if the UI message content contains an agent thought.
 * @param content The UI message content to check.
 * @returns True if the content contains an agent thought.
 */
function containsAgentThought(content: UiMessageContent): boolean {
  if (isA2aPart(content.data)) {
    return isAgentThought(content.data);
  }
  return false;
}
