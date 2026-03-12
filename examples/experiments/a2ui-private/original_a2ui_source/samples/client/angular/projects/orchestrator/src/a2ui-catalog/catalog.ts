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

import { Catalog } from '@a2ui/angular';
import { inputBinding } from '@angular/core';

export const DEMO_CATALOG = {
  Chart: {
    type: () => import('./chart').then((r) => r.Chart),
    bindings: ({ properties }) => [
      inputBinding('type', () => ('type' in properties && properties['type']) || undefined),
      inputBinding('title', () => ('title' in properties && properties['title']) || undefined),
      inputBinding(
        'chartData',
        () => ('chartData' in properties && properties['chartData']) || undefined,
      ),
    ],
  },
  GoogleMap: {
    type: () => import('./google-map').then((r) => r.GoogleMap),
    bindings: ({ properties }) => [
      inputBinding('zoom', () => ('zoom' in properties && properties['zoom']) || 8),
      inputBinding('center', () => ('center' in properties && properties['center']) || undefined),
      inputBinding('pins', () => ('pins' in properties && properties['pins']) || undefined),
      inputBinding('title', () => ('title' in properties && properties['title']) || undefined),
    ],
  },
} as Catalog;
