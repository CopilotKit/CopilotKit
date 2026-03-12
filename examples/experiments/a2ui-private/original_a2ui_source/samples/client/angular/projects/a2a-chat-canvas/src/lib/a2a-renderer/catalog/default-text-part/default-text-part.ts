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

import { TextPart } from '@a2a-js/sdk';
import { RendererComponent } from '@a2a_chat_canvas/a2a-renderer/types';
import { MARKDOWN_RENDERER_SERVICE } from '@a2a_chat_canvas/interfaces/markdown-renderer-service';
import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';

/**
 * Default component for rendering a simple text part from an A2A message.
 * It takes the text content, renders it as Markdown, and sets it as the innerHTML of the host element.
 */
@Component({
  selector: 'default-text-part',
  templateUrl: './default-text-part.html',
  styleUrls: ['./default-text-part.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DefaultTextPart implements RendererComponent {
  /** The UiMessageContent containing the a2a.v1.TextPart. */
  readonly uiMessageContent = input.required<UiMessageContent>();

  /** Service used to render Markdown to SafeHtml. */
  private readonly markdownRendererService = inject(MARKDOWN_RENDERER_SERVICE);

  /** The raw text content from the TextPart. */
  protected readonly text = computed(() => (this.uiMessageContent().data as TextPart).text);

  /** Signal holding the rendered HTML string or SafeHtml. */
  private readonly renderedHtml = signal<SafeHtml | string>('');

  /**
   * Binds the rendered HTML to the host element's innerHTML property.
   * @returns The rendered HTML to be set as innerHTML.
   */
  @HostBinding('innerHTML')
  get innerHtml(): SafeHtml | string {
    return this.renderedHtml();
  }

  /**
   * Constructor sets up an effect to re-render the Markdown whenever the text input changes.
   */
  constructor() {
    effect(async () => {
      // Render the text content using the markdown service and update the signal.
      this.renderedHtml.set(await this.markdownRendererService.render(this.text()));
    });
  }
}
