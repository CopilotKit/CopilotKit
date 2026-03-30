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

import React from 'react';
import {createReactComponent} from '../../../adapter';
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v0_9';

export const TextFieldSchema = z.object({
  label: CommonSchemas.DynamicString,
  value: CommonSchemas.DynamicString,
  variant: z.enum(['longText', 'number', 'shortText', 'obscured']).optional(),
  validationRegexp: z.string().optional(),
});

export const TextFieldApiDef = {
  name: 'TextField',
  schema: TextFieldSchema,
};

export const TextField = createReactComponent(TextFieldApiDef, ({props, context}) => {
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (props.setValue) {
      props.setValue(e.target.value);
    }
  };

  const isLong = props.variant === 'longText';
  const type =
    props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text';

  const style: React.CSSProperties = {
    padding: '8px',
    width: '100%',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxSizing: 'border-box',
  };

  const id = `textfield-${context.componentModel.id}`;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '4px', width: '100%'}}>
      {props.label && (
        <label htmlFor={id} style={{fontSize: '14px', fontWeight: 'bold'}}>
          {props.label}
        </label>
      )}
      {isLong ? (
        <textarea id={id} style={style} value={props.value || ''} onChange={onChange} />
      ) : (
        <input id={id} type={type} style={style} value={props.value || ''} onChange={onChange} />
      )}
    </div>
  );
});
