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

import { Part } from '@a2a-js/sdk';
import { type PartResolver } from '@a2a_chat_canvas/a2a-renderer/types';

/**
 * A PartResolver for identifying A2UI data parts within an A2A message.
 *
 * This resolver checks if a given `Part` is of kind 'data' and specifically contains
 * an A2UI message, which is indicated by the presence of the 'beginRendering' property.
 * If it's an A2UI data part, it returns the variant key 'a2ui_data_part',
 * which maps to the A2uiDataPart component for rendering.
 *
 * @param part The A2A message part to check.
 * @returns The string 'a2ui_data_part' if the part is an A2UI data part, otherwise null.
 */
export const A2UI_DATA_PART_RESOLVER: PartResolver = (part: Part): string | null => {
  // Check if the part is a data part and contains the 'beginRendering' key, which signifies an A2UI message.
  if (
    part.kind === 'data' &&
    part.data &&
    typeof part.data === 'object' &&
    'beginRendering' in part.data
  ) {
    return 'a2ui_data_part';
  }
  return null;
};
