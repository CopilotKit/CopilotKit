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

import {createReactComponent} from '../../../adapter';
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v0_9';
import {ChildList} from './ChildList';

export const ColumnSchema = z.object({
  children: CommonSchemas.ChildList,
  justify: z
    .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])
    .optional(),
  align: z.enum(['center', 'end', 'start', 'stretch']).optional(),
});

const mapJustify = (j?: string) => {
  switch (j) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'spaceAround':
      return 'space-around';
    case 'spaceBetween':
      return 'space-between';
    case 'spaceEvenly':
      return 'space-evenly';
    case 'start':
      return 'flex-start';
    case 'stretch':
      return 'stretch';
    default:
      return 'flex-start';
  }
};

const mapAlign = (a?: string) => {
  switch (a) {
    case 'start':
      return 'flex-start';
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'stretch':
      return 'stretch';
    default:
      return 'stretch';
  }
};

export const ColumnApiDef = {
  name: 'Column',
  schema: ColumnSchema,
};

export const Column = createReactComponent(ColumnApiDef, ({props, buildChild}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        gap: '8px',
      }}
    >
      <ChildList childList={props.children} buildChild={buildChild} />
    </div>
  );
});
