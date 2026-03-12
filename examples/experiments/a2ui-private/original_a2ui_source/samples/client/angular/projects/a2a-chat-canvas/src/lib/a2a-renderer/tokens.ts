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

import { InjectionToken, inject } from '@angular/core';
import {
  ArtifactResolver,
  PartResolver,
  RendererComponentClassLoader,
  RendererEntry,
} from './types';

/** Injection token for the {@link PartResolver}s for parts. */
export const PART_RESOLVERS = new InjectionToken<readonly PartResolver[]>('PART_RESOLVERS', {
  providedIn: 'root',
  factory: () => [],
});

/** Injection token for the {@link RendererEntry}s for parts. */
export const RENDERERS = new InjectionToken<readonly RendererEntry[]>('RENDERERS', {
  providedIn: 'root',
  factory: () => [],
});

/** Map of variant name to renderer class loader for parts. */
export const RENDERERS_MAP = new InjectionToken<ReadonlyMap<string, RendererComponentClassLoader>>(
  'RENDERERS_MAP',
  {
    factory: () => {
      return renderersToMap(inject(RENDERERS));
    },
  },
);

/** Injection token for the {@link ArtifactResolver}s for artifacts. */
export const ARTIFACT_RESOLVERS = new InjectionToken<readonly ArtifactResolver[]>(
  'ARTIFACT_RESOLVERS',
  { providedIn: 'root', factory: () => [] },
);

function renderersToMap(
  renderers: readonly RendererEntry[],
): ReadonlyMap<string, RendererComponentClassLoader> {
  const rendererNames = new Set(renderers.map(([variantName]) => variantName));
  if (rendererNames.size !== renderers.length) {
    console.warn('Duplicate renderer names found, using only the last one.');
  }
  return new Map(renderers);
}
