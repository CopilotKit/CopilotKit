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
 * A PartResolver for identifying basic text parts within an A2A message.
 *
 * This resolver checks if a given `Part` is of kind 'text'.
 * If it is, it returns the variant key 'default_text_part',
 * which maps to the DefaultTextPart component for rendering the text content.
 *
 * @param part The A2A message part to check.
 * @returns The string 'default_text_part' if the part is a text part, otherwise null.
 */
export const DEFAULT_TEXT_PART_RESOLVER: PartResolver = (part: Part): string | null => {
  if (part.kind === 'text') {
    return 'default_text_part';
  }
  return null;
};
