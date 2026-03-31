/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export * from './A2uiSurface';
export * from './adapter';

// Export basic catalog components directly for 3P developers
export * from './catalog/basic';

// Export minimal catalog under a namespace to avoid symbol conflicts
export * as MinimalCatalog from './catalog/minimal';
export {minimalCatalog} from './catalog/minimal';
