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
import {ImageApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle} from '../utils';

export const Image = createReactComponent(ImageApi, ({props}) => {
  const mapFit = (fit?: string): React.CSSProperties['objectFit'] => {
    if (fit === 'scaleDown') return 'scale-down';
    return (fit as React.CSSProperties['objectFit']) || 'fill';
  };

  const style: React.CSSProperties = {
    ...getBaseLeafStyle(),
    objectFit: mapFit(props.fit),
    width: '100%',
    height: 'auto',
    display: 'block',
  };

  if (props.variant === 'icon') {
    style.width = '24px';
    style.height = '24px';
  } else if (props.variant === 'avatar') {
    style.width = '40px';
    style.height = '40px';
    style.borderRadius = '50%';
  } else if (props.variant === 'smallFeature') {
    style.maxWidth = '100px';
  } else if (props.variant === 'largeFeature') {
    style.maxHeight = '400px';
  } else if (props.variant === 'header') {
    style.height = '200px';
    style.objectFit = 'cover';
  }

  return <img src={props.url} alt={props.description || ''} style={style} />;
});
