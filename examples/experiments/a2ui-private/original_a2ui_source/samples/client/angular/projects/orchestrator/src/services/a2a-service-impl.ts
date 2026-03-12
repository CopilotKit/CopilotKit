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

import { AgentCard, Part, SendMessageSuccessResponse } from '@a2a-js/sdk';
import { A2aService } from '@a2a_chat_canvas/interfaces/a2a-service';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class A2aServiceImpl implements A2aService {
  public componentCatalog: string = '';

  async sendMessage(parts: Part[], signal?: AbortSignal): Promise<SendMessageSuccessResponse> {
    const response = await fetch('/a2a', {
      body: JSON.stringify({ parts: parts, component_catalog: this.componentCatalog }),
      method: 'POST',
      signal,
    });

    if (response.ok) {
      const data = await response.json();
      return data;
    }

    const error = (await response.json()) as { error: string };
    throw new Error(error.error);
  }

  async getAgentCard(): Promise<AgentCard> {
    const response = await fetch('/a2a/agent-card');
    if (!response.ok) {
      throw new Error('Failed to fetch agent card');
    }
    const card = await response.json() as AgentCard;
    return card;
  }
}
