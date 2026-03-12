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

import { A2aRenderer } from '@a2a_chat_canvas/a2a-renderer/a2a-renderer';
import { Avatar } from '@a2a_chat_canvas/components/chat/avatar/avatar';
import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { SafeUrl } from '@angular/platform-browser';

/** Header for the agent. */
@Component({
  selector: 'agent-header',
  templateUrl: './agent-header.html',
  styleUrl: './agent-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, A2aRenderer, MatButton, MatIcon],
})
export class AgentHeader {
  private static instanceCount = 0;

  /** The URL for the agent's icon. */
  readonly agentIconUrl = input<string | SafeUrl | undefined>(undefined);
  /** The name of the agent. */
  readonly agentName = input<string | undefined>(undefined);
  /** Whether to show a progress indicator on the agent's avatar. */
  readonly showProgressIndicator = input<boolean>(false);
  /** Optional status text to display next to the agent's name. */
  readonly statusText = input<string | undefined>(undefined);
  /** Optional array of agent thought contents to display when expanded. */
  readonly agentThoughts = input<readonly UiMessageContent[] | undefined>(undefined);

  /** Whether the agent thoughts section is expanded. */
  protected readonly expanded = signal<boolean>(false);
  /** Whether there are any agent thoughts to display. */
  protected readonly containsAgentThoughts = computed(() => {
    const agentThoughts = this.agentThoughts();
    return agentThoughts && agentThoughts.length > 0;
  });
  /** Unique ID for this component instance. */
  private readonly instanceId = AgentHeader.instanceCount++;
  /** Unique ID for the agent thoughts button. */
  protected readonly agentThoughtsButtonId = `view-agent-thoughts-button-${this.instanceId}`;
  /** Unique ID for the agent thoughts content section. */
  protected readonly agentThoughtsContentId = `agent-thoughts-content-${this.instanceId}`;
}
