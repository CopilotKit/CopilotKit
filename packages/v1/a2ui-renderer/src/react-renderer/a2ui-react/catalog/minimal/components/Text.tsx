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

export const TextSchema = z.object({
  text: CommonSchemas.DynamicString,
  variant: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']).optional(),
});

export const TextApiDef = {
  name: 'Text',
  schema: TextSchema,
};

export const Text = createReactComponent(TextApiDef, ({props}) => {
  const text = props.text ?? '';
  switch (props.variant) {
    case 'h1':
      return <h1>{text}</h1>;
    case 'h2':
      return <h2>{text}</h2>;
    case 'h3':
      return <h3>{text}</h3>;
    case 'h4':
      return <h4>{text}</h4>;
    case 'h5':
      return <h5>{text}</h5>;
    case 'caption':
      return <small>{text}</small>;
    case 'body':
    default:
      return <span>{text}</span>;
  }
});
