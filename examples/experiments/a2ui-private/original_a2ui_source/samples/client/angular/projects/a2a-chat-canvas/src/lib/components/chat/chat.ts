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

import { ChatHistory } from '@a2a_chat_canvas/components/chat/chat-history/chat-history';
import { MessageDecorator } from '@a2a_chat_canvas/components/chat/chat-history/message-decorator/types';
import { InputArea } from '@a2a_chat_canvas/components/chat/input-area/input-area';
import { ChatService } from '@a2a_chat_canvas/services/chat-service';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  TemplateRef,
} from '@angular/core';

/**
 * Main component for the chat interface.
 * It orchestrates the chat history display and the input area.
 */
@Component({
  selector: 'chat',
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatHistory, InputArea],
})
export class Chat {
  readonly emptyHistoryTemplate = input<TemplateRef<unknown>>();
  /** Optional function to provide a custom message decorator component. */
  readonly messageDecorator = input<MessageDecorator>();

  /** Service for managing chat interactions. */
  private readonly chatService = inject(ChatService);

  /** The chat message history. */
  readonly history = computed(() => this.chatService.history());
}
