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

import { Artifact, Message, Part, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';

const ADK_A2A_THOUGHT_KEY = 'adk_thought';

/**
 * Returns true if the part is a thought.
 *
 * @param part The part to check.
 * @return True if the part is a thought, false otherwise.
 */
export function isAgentThought(part: Part): boolean {
  return part.metadata?.[ADK_A2A_THOUGHT_KEY] === 'true';
}

/**
 * Extracts all A2A Parts from a SendMessageSuccessResponse.
 * If the response contains a Task, it flattens the parts from the task status message and any artifacts.
 * If the response contains a Message, it returns the parts from the message.
 *
 * @param response The SendMessageSuccessResponse from the A2A service.
 * @returns An array of all contained A2A Parts.
 */
export function extractA2aPartsFromResponse(response: SendMessageSuccessResponse): Part[] {
  if (response.result.kind === 'task') {
    const task: Task = response.result;
    return [
      ...(task.status.message?.parts ?? []),
      ...(task.artifacts ?? []).flatMap((artifact: Artifact) => {
        return artifact.parts;
      }),
    ];
  } else {
    const message: Message = response.result;
    return message.parts;
  }
}
