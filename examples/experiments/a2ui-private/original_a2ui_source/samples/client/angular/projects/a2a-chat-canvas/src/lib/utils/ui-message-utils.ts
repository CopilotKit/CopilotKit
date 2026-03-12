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
import { PartResolver, UNRESOLVED_PART_VARIANT } from '@a2a_chat_canvas/a2a-renderer/types';
import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { v4 as uuid } from 'uuid';

/**
 * Converts a Part to a UiMessageContent.
 *
 * Part containing the RemoteUiEvent of ui tool response is not converted
 * because that event should not be displayed in chat canvas.
 *
 * @param part The Part to convert.
 * @param partResolvers The list of PartResolvers to use.
 * @return The UiMessageContent converted from the Part.
 */
export function convertPartToUiMessageContent(
  part: Part,
  partResolvers: readonly PartResolver[],
): UiMessageContent {
  return {
    type: 'ui_message_content',
    id: uuid(),
    data: part,
    variant: resolvePartVariant(part, partResolvers),
  };
}

/**
 * Resolves the variant for a2a.v1.Part.
 *
 * @param part The part to resolve.
 * @param partResolvers The list of part resolvers to use.
 * @return The variant string.
 */
function resolvePartVariant(part: Part, partResolvers: readonly PartResolver[]): string {
  for (const resolver of partResolvers) {
    const variant = resolver(part);
    if (variant !== null) {
      return variant;
    }
  }
  return UNRESOLVED_PART_VARIANT;
}
