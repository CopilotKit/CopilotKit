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
import {CheckBoxApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN} from '../utils';

export const CheckBox = createReactComponent(CheckBoxApi, ({props}) => {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.setValue(e.target.checked);
  };

  const uniqueId = React.useId();

  const hasError = props.validationErrors && props.validationErrors.length > 0;

  return (
    <div style={{display: 'flex', flexDirection: 'column', margin: LEAF_MARGIN}}>
      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
        <input
          id={uniqueId}
          type="checkbox"
          checked={!!props.value}
          onChange={onChange}
          style={{cursor: 'pointer', outline: hasError ? '1px solid red' : 'none'}}
        />
        {props.label && (
          <label
            htmlFor={uniqueId}
            style={{cursor: 'pointer', color: hasError ? 'red' : 'inherit'}}
          >
            {props.label}
          </label>
        )}
      </div>
      {hasError && (
        <span style={{fontSize: '12px', color: 'red', marginTop: '4px'}}>
          {props.validationErrors?.[0]}
        </span>
      )}
    </div>
  );
});
