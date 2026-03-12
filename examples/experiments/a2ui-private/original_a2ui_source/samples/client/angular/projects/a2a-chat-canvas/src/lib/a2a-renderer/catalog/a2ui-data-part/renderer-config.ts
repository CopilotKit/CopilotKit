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
 * Renderer catalog entry for the 'a2ui_data_part' variant.
 *
 * This entry maps the string key 'a2ui_data_part' (as determined by the resolver)
 * to a function that dynamically imports and returns the `A2uiDataPart` component.
 * This allows for lazy loading of the component, improving initial load performance.
 *
 * The A2aRenderer uses this entry to know which component to render when it encounters
 * a UiMessageContent with the 'a2ui_data_part' variant.
 */
export const A2UI_DATA_PART_RENDERER_ENTRY: RendererEntry = [
  'a2ui_data_part',
  async () => {
    const { A2uiDataPart } = await import(
      '@a2a_chat_canvas/a2a-renderer/catalog/a2ui-data-part/a2ui-data-part'
    );
    return A2uiDataPart;
  },
];
