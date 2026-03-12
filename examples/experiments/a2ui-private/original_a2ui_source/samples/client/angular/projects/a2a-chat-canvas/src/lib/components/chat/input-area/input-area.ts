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

import { ChatService } from '@a2a_chat_canvas/services/chat-service';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatTooltip } from '@angular/material/tooltip';

/** Input area for the user to enter text. */
@Component({
  selector: 'input-area',
  templateUrl: './input-area.html',
  styleUrls: ['./input-area.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkTextareaAutosize,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatTooltip,
    ReactiveFormsModule,
  ],
})
export class InputArea {
  /** Service for managing chat interactions. */
  protected readonly chatService = inject(ChatService);

  /** Form group for the chat input. */
  protected readonly formGroup = new FormGroup({
    query: new FormControl('', {
      nonNullable: true,
    }),
  });

  /** Reference to the form element. */
  protected readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  /** Reference to the textarea element. */
  protected readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');

  /**
   * Submits the form if the Enter key is pressed without Shift, Ctrl, or Meta keys.
   * @param event The DOM event.
   */
  protected submitIfEnterKeydownEvent(event: Event) {
    if (
      !isKeyboardEvent(event) ||
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    event.preventDefault();
    this.form().nativeElement.requestSubmit();
  }

  /**
   * Validates the input and sends the message to the chat service.
   * Resets the form after sending.
   */
  protected validateAndSendMessage() {
    if (this.formGroup.controls.query.value.trim() === '') {
      return;
    }

    this.chatService.cancelOngoingStream();
    this.chatService.sendMessage(this.formGroup.value.query!);
    this.formGroup.reset();
  }

  /**
   * Cancels any ongoing message stream and focuses the input textarea.
   */
  protected cancelOngoingStreamAndFocusInput() {
    this.chatService.cancelOngoingStream();
    this.textarea().nativeElement.focus();
  }
}

/**
 * Type guard to check if an Event is a KeyboardEvent.
 * @param event The event to check.
 * @returns True if the event is a KeyboardEvent and the type is 'keydown'.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return event.type === 'keydown';
}
