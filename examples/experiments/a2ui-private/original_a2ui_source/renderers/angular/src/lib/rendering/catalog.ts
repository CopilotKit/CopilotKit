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

import { Binding, InjectionToken, Type } from '@angular/core';
import { DynamicComponent } from './dynamic-component';
import * as v0_8 from '@a2ui/web-lib/0.8';

export type CatalogLoader = () =>
  | Promise<Type<DynamicComponent<any>>>
  | Type<DynamicComponent<any>>;

export type CatalogEntry<T extends v0_8.Types.AnyComponentNode> =
  | CatalogLoader
  | {
      type: CatalogLoader;
      bindings: (data: T) => Binding[];
    };

export interface Catalog {
  [key: string]: CatalogEntry<v0_8.Types.AnyComponentNode>;
}

export const Catalog = new InjectionToken<Catalog>('Catalog');
