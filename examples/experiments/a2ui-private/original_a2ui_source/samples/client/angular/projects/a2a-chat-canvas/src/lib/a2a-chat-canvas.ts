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

import { Canvas } from '@a2a_chat_canvas/components/canvas/canvas';
import { Chat } from '@a2a_chat_canvas/components/chat/chat';
import { MessageDecorator } from '@a2a_chat_canvas/components/chat/chat-history/message-decorator/types';
import { Component, computed, inject, input, TemplateRef } from '@angular/core';
import { CanvasService } from './services/canvas-service';

/**
 * The main component for the A2A Chat Canvas library.
 * It orchestrates the Chat and Canvas components, displaying the Canvas when a surfaceId is set in the CanvasService.
 */
@Component({
  selector: 'a2a-chat-canvas',
  templateUrl: './a2a-chat-canvas.html',
  styleUrl: './a2a-chat-canvas.scss',
  imports: [Canvas, Chat],
})
export class A2aChatCanvas {
  readonly emptyHistoryTemplate = input<TemplateRef<unknown>>();
  /** Optional function to provide a custom message decorator component. */
  readonly messageDecorator = input<MessageDecorator>();

  /** Service for managing the canvas state. */
  private readonly canvasService = inject(CanvasService);

  /** Whether the canvas is currently open (i.e., a surfaceId is set). */
  protected isCanvasOpened = computed(() => !!this.canvasService.surfaceId());
}
