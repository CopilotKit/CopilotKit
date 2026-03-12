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

import { MessageDecorator } from '@a2a_chat_canvas/components/chat/chat-history/message-decorator/types';
import { Message } from '@a2a_chat_canvas/components/chat/message/message';
import { ChatService } from '@a2a_chat_canvas/services/chat-service';
import { UiMessage } from '@a2a_chat_canvas/types/ui-message';
import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  resource,
  viewChildren,
} from '@angular/core';

/** Chat history component. */
@Component({
  selector: 'chat-history',
  templateUrl: './chat-history.html',
  styleUrl: './chat-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Message, NgComponentOutlet, NgTemplateOutlet],
})
export class ChatHistory {
  /** The list of messages to display. */
  readonly history = input.required<UiMessage[]>();

  /** Optional template to display when the history is empty. */
  readonly emptyHistoryTemplate = input<TemplateRef<unknown>>();
  /** Optional function to provide a custom message decorator component. */
  readonly messageDecorator = input<MessageDecorator | undefined>(undefined);

  /** Service for managing chat interactions. */
  private readonly chatService = inject(ChatService);
  /** References to the turn container elements in the template. */
  private readonly turnContainers = viewChildren<ElementRef<HTMLElement>>('turnContainer');

  /**
   * Computes the chat history grouped by turns.
   * A turn consists of a user message followed by any number of agent messages.
   */
  protected readonly historyByTurn = computed(() => {
    const history = this.history();
    const historyByTurn: UiMessage[][] = [];
    let currentTurn: UiMessage[] = [];
    for (const message of history) {
      if (currentTurn.length === 0) {
        currentTurn.push(message);
        continue;
      }
      // If current message is an agent message, and it follows a user message,
      // then group it with the user message in the same turn.
      const lastMessage = currentTurn[currentTurn.length - 1];
      if (message.role.type === 'ui_agent' && lastMessage.role.type === 'ui_user') {
        currentTurn.push(message);
      } else {
        // Otherwise, start a new turn. Successive agent messages that belong
        // to the same task are already grouped together.
        historyByTurn.push(currentTurn);
        currentTurn = [message];
      }
    }
    if (currentTurn.length > 0) {
      historyByTurn.push(currentTurn);
    }
    return historyByTurn;
  });

  /** Resolves the message decorator component. */
  protected readonly resolvedMessageDecorator = resource({
    params: this.messageDecorator,
    loader: async ({ params }) => {
      if (!params) {
        return null;
      }
      return await params();
    },
  });

  /** The current A2UI surfaces from the chat service. */
  protected readonly surfaces = computed(() => this.chatService.a2uiSurfaces());

  constructor() {
    // When the number of turn containers changes it means that the history has
    // been updated and we should scroll to the newly added last turn container.
    afterRenderEffect({
      write: () => {
        const turnContainers = this.turnContainers();
        const turnContainer = turnContainers.at(-1)?.nativeElement;
        turnContainer?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
      },
    });
  }
}
