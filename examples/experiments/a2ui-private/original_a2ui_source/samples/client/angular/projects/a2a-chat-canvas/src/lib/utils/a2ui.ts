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
import * as v0_8 from '@a2ui/web-lib/0.8';
import { isA2aDataPart } from './type-guards';

/**
 * Extracts A2UI ServerToClientMessages from an array of A2A Parts.
 * It filters for parts that are A2A DataParts and checks for the presence of A2UI message keys
 * (beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface).
 *
 * @param parts An array of A2A Parts.
 * @returns An array of A2UI v0_8.Types.ServerToClientMessage objects.
 */
export function extractA2uiDataParts(parts: Part[]) {
  return parts.reduce<v0_8.Types.ServerToClientMessage[]>((messages, part) => {
    if (isA2aDataPart(part)) {
      if (part.data && typeof part.data === 'object') {
        if ('beginRendering' in part.data) {
          messages.push({
            beginRendering: part.data['beginRendering'] as v0_8.Types.BeginRenderingMessage,
          });
        } else if ('surfaceUpdate' in part.data) {
          messages.push({
            surfaceUpdate: part.data['surfaceUpdate'] as v0_8.Types.SurfaceUpdateMessage,
          });
        } else if ('dataModelUpdate' in part.data) {
          messages.push({
            dataModelUpdate: part.data['dataModelUpdate'] as v0_8.Types.DataModelUpdate,
          });
        } else if ('deleteSurface' in part.data) {
          messages.push({
            deleteSurface: part.data['deleteSurface'] as v0_8.Types.DeleteSurfaceMessage,
          });
        }
      }
    }
    return messages;
  }, []);
}
