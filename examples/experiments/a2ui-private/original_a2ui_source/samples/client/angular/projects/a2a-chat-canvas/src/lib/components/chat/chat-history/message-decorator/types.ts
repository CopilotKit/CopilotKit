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

import { UiMessage } from '@a2a_chat_canvas/types/ui-message';
import { InputSignal, TemplateRef, Type } from '@angular/core';

/** Interface for a component that decorates a message. */
export interface MessageDecoratorComponent {
  /** The UI message. */
  readonly message: InputSignal<UiMessage>;
  /** The template reference for the core content of the message. */
  readonly coreContentTemplateRef: InputSignal<TemplateRef<unknown>>;
}

/** A function called to decorate a message with additional UI. */
export type MessageDecorator = () => Promise<Type<MessageDecoratorComponent>>;
