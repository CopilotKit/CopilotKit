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
import {TextFieldApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN, STANDARD_BORDER, STANDARD_RADIUS} from '../utils';

export const TextField = createReactComponent(TextFieldApi, ({props}) => {
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    props.setValue(e.target.value);
  };

  const isLong = props.variant === 'longText';
  const type =
    props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text';

  const style: React.CSSProperties = {
    padding: '8px',
    width: '100%',
    border: STANDARD_BORDER,
    borderRadius: STANDARD_RADIUS,
    boxSizing: 'border-box',
  };

  // Note: To have a unique id without passing context we can use a random or provided id,
  // but the simplest is just relying on React's useId if we really need it.
  // For now, we'll omit the `id` from the label connection since we removed context.
  const uniqueId = React.useId();

  const hasError = props.validationErrors && props.validationErrors.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        width: '100%',
        margin: LEAF_MARGIN,
      }}
    >
      {props.label && (
        <label htmlFor={uniqueId} style={{fontSize: '14px', fontWeight: 'bold'}}>
          {props.label}
        </label>
      )}
      {isLong ? (
        <textarea
          id={uniqueId}
          style={{...style, borderColor: hasError ? 'red' : STANDARD_BORDER}}
          value={props.value || ''}
          onChange={onChange}
        />
      ) : (
        <input
          id={uniqueId}
          type={type}
          style={{...style, borderColor: hasError ? 'red' : STANDARD_BORDER}}
          value={props.value || ''}
          onChange={onChange}
        />
      )}
      {hasError && (
        <span style={{fontSize: '12px', color: 'red'}}>{props.validationErrors![0]}</span>
      )}
    </div>
  );
});
