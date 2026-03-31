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
import {ButtonApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN} from '../utils';

export const Button = createReactComponent(ButtonApi, ({props, buildChild}) => {
  const style: React.CSSProperties = {
    margin: LEAF_MARGIN,
    padding: '8px 16px',
    cursor: 'pointer',
    border: props.variant === 'borderless' ? 'none' : '1px solid #ccc',
    backgroundColor:
      props.variant === 'primary'
        ? 'var(--a2ui-primary-color, #007bff)'
        : props.variant === 'borderless'
          ? 'transparent'
          : '#fff',
    color: props.variant === 'primary' ? '#fff' : 'inherit',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  };

  return (
    <button style={style} onClick={props.action} disabled={props.isValid === false}>
      {props.child ? buildChild(props.child) : null}
    </button>
  );
});
