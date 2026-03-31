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
import {RowApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {ChildList} from './ChildList';
import {mapJustify, mapAlign} from '../utils';

export const Row = createReactComponent(RowApi, ({props, buildChild, context}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: '100%',
        margin: 0,
        padding: 0,
      }}
    >
      <ChildList childList={props.children} buildChild={buildChild} context={context} />
    </div>
  );
});
