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

export const ChildList: React.FC<{
  childList: unknown;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
}> = ({childList, buildChild}) => {
  if (Array.isArray(childList)) {
    return (
      <>
        {childList.map((item: unknown, i: number) => {
          // The new binder outputs objects like { id: string, basePath: string } for arrays of structural nodes
          if (item && typeof item === 'object' && 'id' in item) {
            const node = item as {id: string; basePath?: string};
            return (
              <React.Fragment key={`${node.id}-${i}`}>
                {buildChild(node.id, node.basePath)}
              </React.Fragment>
            );
          }
          // Fallback for static string lists
          if (typeof item === 'string') {
            return <React.Fragment key={`${item}-${i}`}>{buildChild(item)}</React.Fragment>;
          }
          return null;
        })}
      </>
    );
  }

  return null;
};
