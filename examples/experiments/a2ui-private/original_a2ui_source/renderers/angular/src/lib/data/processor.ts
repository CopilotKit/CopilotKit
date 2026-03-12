/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import * as v0_8 from '@a2ui/web-lib/0.8';
import { Injectable } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

export interface DispatchedEvent {
  message: v0_8.Types.A2UIClientEventMessage;
  completion: Subject<v0_8.Types.ServerToClientMessage[]>;
}

@Injectable({ providedIn: 'root' })
export class ModelProcessor extends v0_8.Data.A2UIModelProcessor {
  readonly events = new Subject<DispatchedEvent>();

  override setData(
    node: v0_8.Types.AnyComponentNode,
    relativePath: string,
    value: v0_8.Types.DataValue,
    surfaceId?: v0_8.Types.SurfaceID | null
  ) {
    // Override setData to convert from optional inputs (which can be null)
    // to undefined so that this correctly falls back to the default value for
    // surfaceId.
    return super.setData(node, relativePath, value, surfaceId ?? undefined);
  }

  dispatch(message: v0_8.Types.A2UIClientEventMessage): Promise<v0_8.Types.ServerToClientMessage[]> {
    const completion = new Subject<v0_8.Types.ServerToClientMessage[]>();
    this.events.next({ message, completion });
    return firstValueFrom(completion);
  }
}
