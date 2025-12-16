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

import { SignalWatcher } from "@lit-labs/signals";
import { provide } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import { v0_8 } from "@a2ui/lit";
import * as UI from "@a2ui/lit/ui";
import { globalStyles } from "./styles/global.js";

export type ThemedA2UISurfaceActionCallback = (
  event: v0_8.Events.StateEvent<"a2ui.action">,
  context: ThemedA2UISurfaceContext,
) => void;

export type ThemedA2UISurfaceContext = {
  surfaceId: v0_8.Types.SurfaceID | null;
  surface: v0_8.Types.Surface | null;
  processor: InstanceType<typeof v0_8.Data.A2uiMessageProcessor> | null;
};

@customElement("themed-a2ui-surface")
export class ThemedA2UISurface extends SignalWatcher(LitElement) {
  @provide({ context: UI.Context.themeContext })
  @property({ attribute: false })
  accessor theme!: v0_8.Types.Theme;

  @property({ attribute: false })
  accessor surfaceId: v0_8.Types.SurfaceID | null = null;

  @property({ attribute: false })
  accessor surface: v0_8.Types.Surface | null = null;

  @property({ attribute: false })
  accessor processor: InstanceType<typeof v0_8.Data.A2uiMessageProcessor> | null = null;

  @property({ attribute: false })
  accessor onAction: ThemedA2UISurfaceActionCallback | null = null;

  #handleAction = (event: v0_8.Events.StateEvent<"a2ui.action">) => {
    this.onAction?.(event, {
      surfaceId: this.surfaceId,
      surface: this.surface,
      processor: this.processor,
    });
  };

  render() {
    return html`<style>
        ${globalStyles}
      </style>
      <a2ui-surface
        @a2uiaction=${this.#handleAction}
        .surfaceId=${this.surfaceId}
        .surface=${this.surface}
        .processor=${this.processor}
      ></a2ui-surface>`;
  }
}
