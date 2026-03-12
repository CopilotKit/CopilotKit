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
import { InjectionToken } from '@angular/core';

/**
 * Interface for the A2A (Agent-to-Agent) service.
 * Defines the contract for sending messages to an agent and retrieving agent information.
 */
export interface A2aService {
  /**
   * Sends a message to the agent.
   * @param parts An array of message parts to send.
   * @param signal An optional AbortSignal to cancel the request.
   * @returns A Promise that resolves with the success response from the agent.
   */
  sendMessage(parts: Part[], signal?: AbortSignal): Promise<SendMessageSuccessResponse>;

  /**
   * Retrieves the agent card information.
   * @returns A Promise that resolves with the AgentCard.
   */
  getAgentCard(): Promise<AgentCard>;
}

/**
 * Injection token for the A2aService interface.
 */
export const A2A_SERVICE = new InjectionToken<A2aService>('A2aService');
