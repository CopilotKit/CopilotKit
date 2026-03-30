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
import {CardApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseContainerStyle} from '../utils';

export const Card = createReactComponent(CardApi, ({props, buildChild}) => {
  const style: React.CSSProperties = {
    ...getBaseContainerStyle(),
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    width: '100%',
  };

  return <div style={style}>{props.child ? buildChild(props.child) : null}</div>;
});
