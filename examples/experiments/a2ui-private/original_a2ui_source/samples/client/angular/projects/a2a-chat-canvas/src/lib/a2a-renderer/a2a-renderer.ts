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

import { RENDERERS_MAP } from '@a2a_chat_canvas/a2a-renderer/tokens';
import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { NgComponentOutlet } from '@angular/common';
import { Component, inject, input, resource } from '@angular/core';

/**
 * Dynamically renders a component based on the provided UiMessageContent and variant.
 * It uses a map of renderers to find the appropriate component to load and display.
 */
@Component({
  selector: 'a2a-renderer',
  templateUrl: './a2a-renderer.html',
  styleUrl: './a2a-renderer.scss',
  imports: [NgComponentOutlet],
})
export class A2aRenderer {
  /** The UiMessageContent to be rendered. */
  readonly uiMessageContent = input.required<UiMessageContent>();

  /** Injection token for the map of renderer component loaders. */
  private readonly renderersMap = inject(RENDERERS_MAP);

  /** Resource that loads the component class based on the current variant. */
  protected readonly componentClassResource = resource({
    loader: async () => {
      const componentClassLoader = this.renderersMap.get(this.uiMessageContent().variant);
      if (!componentClassLoader) {
        console.warn(`No renderer found for variant: ${this.uiMessageContent().variant}`);
        return null;
      }
      return componentClassLoader();
    },
  });
}
