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

import {useState} from 'react';
import {createReactComponent} from '../../../adapter';
import {TabsApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN} from '../utils';

// The type of a tab is deeply nested into the TabsApi schema, and
// it seems z.infer is not inferring it correctly (?). We use `any` for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _Tab = any;

export const Tabs = createReactComponent(TabsApi, ({props, buildChild}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabs = props.tabs || [];
  const activeTab = tabs[selectedIndex];

  return (
    <div style={{display: 'flex', flexDirection: 'column', width: '100%', margin: LEAF_MARGIN}}>
      <div style={{display: 'flex', borderBottom: '1px solid #ccc', marginBottom: '8px'}}>
        {tabs.map((tab: _Tab, i: number) => (
          <button
            key={i}
            onClick={() => setSelectedIndex(i)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              borderBottom:
                selectedIndex === i ? '2px solid var(--a2ui-primary-color, #007bff)' : 'none',
              fontWeight: selectedIndex === i ? 'bold' : 'normal',
              cursor: 'pointer',
              color: selectedIndex === i ? 'var(--a2ui-primary-color, #007bff)' : 'inherit',
            }}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div style={{flex: 1}}>{activeTab ? buildChild(activeTab.child) : null}</div>
    </div>
  );
});
