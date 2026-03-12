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

import { RendererEntry } from '@a2a_chat_canvas/a2a-renderer/types';

/**
 * Renderer catalog entry for the 'default_text_part' variant.
 *
 * This entry maps the string key 'default_text_part' (as determined by the resolver)
 * to a function that dynamically imports and returns the `DefaultTextPart` component.
 * This allows for lazy loading of the component, improving initial load performance.
 *
 * The A2aRenderer uses this entry to know which component to render when it encounters
 * a UiMessageContent with the 'default_text_part' variant.
 */
export const DEFAULT_TEXT_PART_RENDERER_ENTRY: RendererEntry = [
  'default_text_part',
  async () => {
    const { DefaultTextPart } = await import(
      '@a2a_chat_canvas/a2a-renderer/catalog/default-text-part/default-text-part'
    );
    return DefaultTextPart;
  },
];
