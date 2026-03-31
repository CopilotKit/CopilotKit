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
import {DateTimeInputApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN, STANDARD_BORDER, STANDARD_RADIUS} from '../utils';

export const DateTimeInput = createReactComponent(DateTimeInputApi, ({props}) => {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.setValue(e.target.value);
  };

  const uniqueId = React.useId();

  // Map enableDate/enableTime to input type
  let type = 'datetime-local';
  if (props.enableDate && !props.enableTime) type = 'date';
  if (!props.enableDate && props.enableTime) type = 'time';

  const style: React.CSSProperties = {
    padding: '8px',
    width: '100%',
    border: STANDARD_BORDER,
    borderRadius: STANDARD_RADIUS,
    boxSizing: 'border-box',
  };

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
      <input
        id={uniqueId}
        type={type}
        style={style}
        value={props.value || ''}
        onChange={onChange}
        min={typeof props.min === 'string' ? props.min : undefined}
        max={typeof props.max === 'string' ? props.max : undefined}
      />
    </div>
  );
});
