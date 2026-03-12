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

import { DataPart, Part, TextPart } from '@a2a-js/sdk';

/**
 * Type guard to check if an A2A Part is a TextPart.
 * @param part The Part to check.
 * @returns True if the part is a TextPart, false otherwise.
 */
export function isA2aTextPart(part: Part): part is TextPart {
  return 'kind' in part && part.kind === 'text';
}

/**
 * Type guard to check if an A2A Part is a DataPart.
 * @param part The Part to check.
 * @returns True if the part is a DataPart, false otherwise.
 */
export function isA2aDataPart(part: Part): part is DataPart {
  return 'kind' in part && part.kind === 'data';
}

/**
 * Type guard to check if a given data object is an A2A Part.
 * Checks for the presence of the 'kind' property.
 * @param data The data to check.
 * @returns True if the data is an A2A Part, false otherwise.
 */
export function isA2aPart(data: any): data is Part {
  return data && typeof data === 'object' && 'kind' in data;
}
