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
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle} from '../utils';

export const Text = createReactComponent(TextApi, ({props}) => {
  const text = props.text ?? '';
  const style: React.CSSProperties = {
    ...getBaseLeafStyle(),
    display: 'inline-block',
  };

  switch (props.variant) {
    case 'h1':
      return <h1 style={style}>{text}</h1>;
    case 'h2':
      return <h2 style={style}>{text}</h2>;
    case 'h3':
      return <h3 style={style}>{text}</h3>;
    case 'h4':
      return <h4 style={style}>{text}</h4>;
    case 'h5':
      return <h5 style={style}>{text}</h5>;
    case 'caption':
      return <caption style={{...style, color: '#666', textAlign: 'left'}}>{text}</caption>;
    case 'body':
    default:
      return <span style={style}>{text}</span>;
  }
});
