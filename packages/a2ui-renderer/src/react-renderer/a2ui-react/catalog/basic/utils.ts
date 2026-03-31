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

import type React from 'react';

/** Standard leaf margin from the implementation guide. */
export const LEAF_MARGIN = '8px';

/** Standard internal padding for visually bounded containers. */
export const CONTAINER_PADDING = '16px';

/** Standard border for cards and inputs. */
export const STANDARD_BORDER = '1px solid #ccc';

/** Standard border radius. */
export const STANDARD_RADIUS = '8px';

export const mapJustify = (j?: string) => {
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

export const mapAlign = (a?: string) => {
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

export const getBaseLeafStyle = (): React.CSSProperties => ({
  margin: LEAF_MARGIN,
  boxSizing: 'border-box',
});

export const getBaseContainerStyle = (): React.CSSProperties => ({
  margin: LEAF_MARGIN,
  padding: CONTAINER_PADDING,
  border: STANDARD_BORDER,
  borderRadius: STANDARD_RADIUS,
  boxSizing: 'border-box',
});
