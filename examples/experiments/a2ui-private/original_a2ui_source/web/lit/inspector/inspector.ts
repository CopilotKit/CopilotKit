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

import { LitElement, html, css, HTMLTemplateResult, unsafeCSS } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { SignalWatcher } from "@lit-labs/signals";
import { provide } from "@lit/context";
import { theme as uiTheme } from "./theme/theme.js";
import "./ui/ui.js";
import { classMap } from "lit/directives/class-map.js";
import { Snackbar } from "./ui/snackbar.js";
import { ref } from "lit/directives/ref.js";
import {
  SnackbarAction,
  SnackbarMessage,
  SnackbarUUID,
  SnackType,
} from "./types/types.js";
import { v0_8 } from "@a2ui/web-lib";
import * as UI from "@a2ui/web-lib/ui";
import { map } from "lit/directives/map.js";

const LAST_ITEM_KEY = "last-item-value";

@customElement("a2ui-layout-inspector")
export class A2UILayoutInspector extends SignalWatcher(LitElement) {
  @provide({ context: UI.Context.themeContext })
  accessor theme: v0_8.Types.Theme = uiTheme;

  @state()
  accessor #ready = true;

  @state()
  accessor #requesting = false;

  #snackbar: Snackbar | undefined = undefined;
  #pendingSnackbarMessages: Array<{
    message: SnackbarMessage;
    replaceAll: boolean;
  }> = [];

  #lastItem: string | null = null;

  static styles = [
    unsafeCSS(v0_8.Styles.structuralStyles),
    css`
      :host {
        display: grid;
        width: 100%;
        height: 100%;
        color: var(--text-color);
        grid-template-rows: 42px 1fr;
      }

      header {
        border-bottom: 1px solid var(--border-color);
        padding: var(--bb-grid-size-2) var(--bb-grid-size-3);
      }

      .rotate {
        animation: rotate 1s linear infinite;
      }

      .g-icon.large {
        font-size: 100px;
      }

      h1,
      h2 {
        display: flex;
        align-items: center;
        margin: 0;

        & .g-icon {
          margin-right: var(--bb-grid-size-2);
        }
      }

      @media (min-height: 960px) {
        #main #controls-container {
          grid-template-rows: 32px 1fr 42px;
          gap: var(--bb-grid-size-5);

          & #controls {
            margin-bottom: var(--bb-grid-size-3);
          }
        }
      }

      #main {
        & ui-splitter {
          height: 100%;
        }

        & #controls-container {
          padding: var(--bb-grid-size-6);
          display: grid;
          grid-template-rows: 32px 1fr 42px;
          gap: var(--bb-grid-size-3);

          & #controls {
            display: flex;
            align-items: end;
            margin-bottom: var(--bb-grid-size-3);

            & button {
              display: flex;
              align-items: center;
              justify-content: center;
              flex: 1;
              min-height: 42px;
              padding: 0;
              border: none;
              background: none;
              color: var(--text-color);
              opacity: 0.5;
              border-bottom: 2px solid var(--border-color);
              transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1),
                border-color 0.3s cubic-bezier(0, 0, 0.3, 1);

              &:not([disabled]):not(.active) {
                cursor: pointer;
              }

              & .g-icon {
                margin-right: var(--bb-grid-size-2);
              }

              &.active {
                opacity: 1;
                border-bottom: 2px solid var(--primary);
              }
            }
          }

          & #upload,
          & #sketch {
            display: none;
            border-radius: var(--bb-grid-size-2);
            border: 1px dashed var(--border-color);
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--elevated-background-light);
            text-align: center;
            gap: var(--bb-grid-size-4);
            overflow: scroll;
            scrollbar-width: none;

            > * {
              max-width: calc(100% - var(--bb-grid-size-8));
              color: var(--n-60);
              max-height: calc(100% - var(--bb-grid-size-8));
              margin: var(--bb-grid-size-4);
              pointer-events: none;
            }

            > drawable-canvas {
              border-radius: var(--bb-grid-size);
              pointer-events: auto;
            }

            > #img {
              position: relative;
              pointer-events: auto;

              &:hover {
                & button {
                  display: flex;
                }
              }

              & button {
                display: none;
                align-items: center;
                justify-content: center;
                border: none;
                border-radius: 50%;
                background: var(--primary);
                color: var(--text-color);
                width: 70px;
                height: 70px;
                position: absolute;
                top: 50%;
                left: 50%;
                translate: -50% -50%;
                padding: 0;

                & .g-icon {
                  font-size: 40px;
                }
              }

              & img {
                width: 100%;
                height: 100%;
                object-fit: contain;
                border-radius: var(--bb-grid-size);
              }
            }

            &.active {
              display: flex;
            }

            & button {
              color: var(--primary);
              border-radius: var(--bb-grid-size-2);
              background: oklch(from var(--primary) l c h / calc(alpha * 0.2));
              opacity: 0.4;
              border: none;
              transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1);
              width: 100%;
              max-width: 420px;
              padding: var(--bb-grid-size-2) var(--bb-grid-size-5);
              pointer-events: auto;

              &:not([disabled]) {
                opacity: 1;
                cursor: pointer;
              }
            }
          }

          & textarea {
            border-radius: var(--bb-grid-size-2);
            border: 1px solid var(--border-color);
            padding: var(--bb-grid-size-2);
            color: var(--text-color);
            background: var(--elevated-background-light);
            resize: none;
            font-family: var(--font-family-mono);
          }

          & button[type="submit"] {
            border-radius: var(--bb-grid-size-2);
            color: var(--text-color);
            background: var(--primary);
            opacity: 0.4;
            border: none;
            transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1);
            width: 100%;
            max-width: 420px;
            justify-self: center;

            &:not([disabled]) {
              opacity: 1;
              cursor: pointer;
            }
          }
        }

        & #surface-container {
          padding: var(--bb-grid-size-6);
          border-left: 1px solid var(--border-color);
          display: grid;
          grid-template-rows: 32px 1fr;
          gap: var(--bb-grid-size-4);

          & #render-mode,
          & #render-mode > span {
            display: flex;
            align-items: center;
            background: none;
            border: none;
            color: var(--primary);
            padding: 0;
          }

          & #render-mode {
            gap: var(--bb-grid-size-3);

            & > span {
              border-radius: var(--bb-grid-size-2);
              background: oklch(from var(--primary) l c h / calc(alpha * 0.2));
              opacity: 0.4;
              border: none;
              transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1);
              width: 100%;
              max-width: 420px;
              padding: var(--bb-grid-size-2) var(--bb-grid-size-5);
              pointer-events: auto;

              &:not(.active):hover {
                opacity: 1;
                cursor: pointer;
              }

              &.active {
                opacity: 1;
                color: var(--text-color);
              }
            }
          }

          & #messages,
          & #surfaces {
            display: flex;
            border-radius: var(--bb-grid-size-2);
            border: 1px dashed var(--border-color);
            align-items: center;
            justify-content: center;
            padding: var(--bb-grid-size-4);
            overflow: scroll;
            scrollbar-width: none;

            & a2ui-surface {
              width: 100%;
              max-width: 640px;
              max-height: 600px;
            }
          }

          & #surfaces {
            background: var(--n-100);
          }

          & #messages {
            position: relative;
            display: block;
            font-family: var(--font-family-mono);
            line-height: 1.5;

            & div {
              white-space: pre-wrap;
            }

            & button {
              position: absolute;
              top: var(--bb-grid-size-3);
              right: var(--bb-grid-size-3);

              display: flex;
              align-items: center;
              border-radius: var(--bb-grid-size-2);
              background: oklch(from var(--primary) l c h / calc(alpha * 0.2));
              opacity: 0.4;
              border: none;
              transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1);
              padding: var(--bb-grid-size-2) var(--bb-grid-size-5)
                var(--bb-grid-size-2) var(--bb-grid-size-2);
              color: var(--primary);

              & .g-icon {
                margin-right: var(--bb-grid-size-2);
              }

              &:not([disabled]) {
                cursor: pointer;

                &:hover,
                &:focus {
                  opacity: 1;
                }
              }
            }
          }

          & #generating-surfaces,
          & #no-surfaces {
            p {
              color: var(--n-60);
            }

            width: 50%;
            max-width: 400px;
            text-align: center;
          }

          & #generating-surfaces {
            & h2 {
              justify-content: center;
              white-space: nowrap;
            }
          }

          & #no-surfaces {
            & h2 {
              display: block;
              text-align: center;
            }
          }
        }
      }

      @keyframes rotate {
        from {
          rotate: 0deg;
        }

        to {
          rotate: 360deg;
        }
      }
    `,
  ];

  constructor() {
    super();

    this.#lastItem = globalThis.localStorage.getItem(LAST_ITEM_KEY) ?? "";
  }

  #processor = v0_8.Data.createSignalA2UIModelProcessor();

  #renderSurfacesOrMessages() {
    if (this.#requesting) {
      return html`<section id="surfaces">
        <div id="generating-surfaces">
          <h2 class="typography-w-400 typography-f-s typography-sz-tl">
            <span class="g-icon filled round rotate">progress_activity</span
            >Generating your UI
          </h2>
          <p class="typography-f-s typography-sz-bl">Working on it...</p>
        </div>
      </section>`;
    }

    const renderNoData = () =>
      html`<section id="surfaces">
        <div id="no-surfaces">
          <h2 class="typography-w-400 typography-f-s typography-sz-tl">
            No UI Generated Yet
          </h2>
          <p class="typography-f-s typography-sz-bl">
            Describe your desired UI in the left panel and click 'Generate UI'
            to see the result here.
          </p>
        </div>
      </section>`;

    const surfaces = this.#processor.getSurfaces();

    if (surfaces.size === 0) {
      return renderNoData();
    }

    return html`<section id="surfaces">
      ${map(this.#processor.getSurfaces(), ([surfaceId, surface]) => {
        return html`<a2ui-surface
              .surfaceId=${surfaceId}
              .surface=${surface}
              .processor=${this.#processor}
            ></a2-uisurface>`;
      })}
    </section>`;
  }

  #renderInput() {
    return html`<textarea
        name="instructions"
        class=${classMap({
          "typography-w-400": true,
          "typography-f-s": true,
          "typography-sz-bl": true,
        })}
        @keydown=${(evt: KeyboardEvent) => {
          if (evt.key !== "Enter" || evt.shiftKey) {
            return;
          }

          if (!(evt.target instanceof HTMLTextAreaElement)) {
            return;
          }

          evt.preventDefault();
          const form = evt.target.closest("form")!;
          form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
        }}
        placeholder="Provide the A2UI payload."
        .value=${this.#lastItem}
      ></textarea>
      <button
        ?disabled=${this.#requesting}
        class=${classMap({
          "typography-w-500": true,
          "typography-f-s": true,
          "typography-sz-bl": true,
        })}
        type="submit"
      >
        Generate UI
      </button> `;
  }

  #renderHeader() {
    return html`<header
      class="typography-w-400 typography-f-sf typography-sz-tm"
    >
      A2UI Inspector
    </header>`;
  }

  #renderMain() {
    return html`<section id="main">
      <ui-splitter
        direction=${"horizontal"}
        name="layout-main"
        split="[0.20, 0.80]"
        .minSegmentSizeHorizontal=${325}
      >
        <form
          id="controls-container"
          slot="slot-0"
          @submit=${async (evt: SubmitEvent) => {
            evt.preventDefault();
            const formData = new FormData(evt.target as HTMLFormElement);
            const instructions = formData.get("instructions");
            if (instructions === null) {
              return;
            }

            try {
              const instructionsStr = instructions as string;

              globalThis.localStorage.setItem(LAST_ITEM_KEY, instructionsStr);
              const messages = JSON.parse(instructionsStr);

              console.log(messages);

              this.#processor.clearSurfaces();
              console.log(this.#processor.getSurfaces().size);
              this.#processor.processMessages(messages);
              this.requestUpdate();
            } catch (err) {
              console.warn(err);
              this.snackbar(html`Unable to render UI`, SnackType.ERROR);
            }
          }}
        >
          <h2 class="typography-w-400 typography-f-s typography-sz-tl">
            Enter your A2UI
          </h2>
          ${this.#renderInput()}
        </form>
        <div id="surface-container" slot="slot-1">
          <h2
            class="typography-w-400 typography-f-s typography-sz-tl layout-sp-bt"
          >
            Generated UI
          </h2>
          ${this.#renderSurfacesOrMessages()}
        </div>
      </ui-splitter>
    </section>`;
  }

  #renderSnackbar() {
    return html`<ui-snackbar
      ${ref((el: Element | undefined) => {
        if (!el) {
          this.#snackbar = undefined;
        }

        this.#snackbar = el as Snackbar;
        for (const pendingMessage of this.#pendingSnackbarMessages) {
          const { message, id, persistent, type, actions } =
            pendingMessage.message;
          this.snackbar(message, type, actions, persistent, id);
        }

        this.#pendingSnackbarMessages.length = 0;
      })}
    ></ui-snackbar>`;
  }

  #renderUI() {
    return [this.#renderHeader(), this.#renderMain(), this.#renderSnackbar()];
  }

  snackbar(
    message: string | HTMLTemplateResult,
    type: SnackType,
    actions: SnackbarAction[] = [],
    persistent = false,
    id = globalThis.crypto.randomUUID(),
    replaceAll = false
  ) {
    if (!this.#snackbar) {
      this.#pendingSnackbarMessages.push({
        message: {
          id,
          message,
          type,
          persistent,
          actions,
        },
        replaceAll,
      });
      return;
    }

    return this.#snackbar.show(
      {
        id,
        message,
        type,
        persistent,
        actions,
      },
      replaceAll
    );
  }

  unsnackbar(id?: SnackbarUUID) {
    if (!this.#snackbar) {
      return;
    }

    this.#snackbar.hide(id);
  }

  render() {
    if (!this.#ready) {
      return html`Loading...`;
    }

    return this.#renderUI();
  }
}
