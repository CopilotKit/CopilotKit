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

import {
  MessageDecorator,
  MessageDecoratorComponent,
} from '@a2a_chat_canvas/components/chat/chat-history/message-decorator/types';
import { UiMessage } from '@a2a_chat_canvas/types/ui-message'; // Assuming path based on context
import { NgTemplateOutlet } from '@angular/common';
import { Component, input, TemplateRef } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-custom-message-decorator',
  styleUrl: './demo-message-decorator.scss',
  templateUrl: './demo-message-decorator.html',
  imports: [MatIcon, MatIconButton, NgTemplateOutlet],
})
export class DemoMessageDecoratorComponent implements MessageDecoratorComponent {
  readonly message = input.required<UiMessage>();

  readonly coreContentTemplateRef = input.required<TemplateRef<unknown>>();
}

export const demoMessageDecorator: MessageDecorator = async () => {
  return DemoMessageDecoratorComponent;
};
