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

import React, {useState} from 'react';
import {createReactComponent} from '../../../adapter';
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {LEAF_MARGIN, STANDARD_BORDER, STANDARD_RADIUS} from '../utils';

// The type of an option is deeply nested into the ChoicePickerApi schema, and
// it seems z.infer is not inferring it correctly (?). We use `any` for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _Option = any;

export const ChoicePicker = createReactComponent(ChoicePickerApi, ({props, context}) => {
  const [filter, setFilter] = useState('');

  const values = Array.isArray(props.value) ? props.value : [];
  const isMutuallyExclusive = props.variant === 'mutuallyExclusive';

  const onToggle = (val: string) => {
    if (isMutuallyExclusive) {
      props.setValue([val]);
    } else {
      const newValues = values.includes(val)
        ? values.filter((v: string) => v !== val)
        : [...values, val];
      props.setValue(newValues);
    }
  };

  const options = (props.options || []).filter(
    (opt: _Option) =>
      !props.filterable ||
      filter === '' ||
      String(opt.label).toLowerCase().includes(filter.toLowerCase())
  );

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: LEAF_MARGIN,
    width: '100%',
  };

  const listStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: props.displayStyle === 'chips' ? 'row' : 'column',
    flexWrap: props.displayStyle === 'chips' ? 'wrap' : 'nowrap',
    gap: '8px',
  };

  return (
    <div style={containerStyle}>
      {props.label && <strong style={{fontSize: '14px'}}>{props.label}</strong>}
      {props.filterable && (
        <input
          type="text"
          placeholder="Filter options..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{padding: '4px 8px', border: STANDARD_BORDER, borderRadius: STANDARD_RADIUS}}
        />
      )}
      <div style={listStyle}>
        {options.map((opt: _Option, i: number) => {
          const isSelected = values.includes(opt.value);
          if (props.displayStyle === 'chips') {
            return (
              <button
                key={i}
                onClick={() => onToggle(opt.value)}
                style={{
                  padding: '4px 12px',
                  borderRadius: '16px',
                  border: isSelected
                    ? '1px solid var(--a2ui-primary-color, #007bff)'
                    : STANDARD_BORDER,
                  backgroundColor: isSelected ? 'var(--a2ui-primary-color, #007bff)' : '#fff',
                  color: isSelected ? '#fff' : 'inherit',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {opt.label}
              </button>
            );
          }
          return (
            <label
              key={i}
              style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}
            >
              <input
                type={isMutuallyExclusive ? 'radio' : 'checkbox'}
                checked={isSelected}
                onChange={() => onToggle(opt.value)}
                name={isMutuallyExclusive ? `choice-${context.componentModel.id}` : undefined}
              />
              <span style={{fontSize: '14px'}}>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
});
