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

import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SnackbarMessage, SnackbarUUID, SnackType } from "../types/types";
import { repeat } from "lit/directives/repeat.js";
import { SnackbarActionEvent } from "../events/events";
import { classMap } from "lit/directives/class-map.js";
import { v0_8 } from "@a2ui/web-lib";

const DEFAULT_TIMEOUT = 8000;

@customElement("ui-snackbar")
export class Snackbar extends LitElement {
  @property({ reflect: true, type: Boolean })
  accessor active = false;

  @property({ reflect: true, type: Boolean })
  accessor error = false;

  @property()
  accessor timeout = DEFAULT_TIMEOUT;

  #messages: SnackbarMessage[] = [];
  #timeout = 0;

  static styles = [
    unsafeCSS(v0_8.Styles.structuralStyles),
    css`
      :host {
        --text-color: var(--n-0);
        --bb-body-medium: 16px;
        --bb-body-line-height-medium: 24px;

        display: flex;
        align-items: center;
        position: fixed;
        bottom: var(--bb-grid-size-7);
        left: 50%;
        translate: -50% 0;
        opacity: 0;
        pointer-events: none;
        border-radius: var(--bb-grid-size-2);
        background: var(--n-90);
        padding: var(--bb-grid-size-3) var(--bb-grid-size-6);
        width: 60svw;
        max-width: 720px;
        z-index: 1800;
        scrollbar-width: none;
        overflow-x: scroll;
        font: 400 var(--bb-body-medium) / var(--bb-body-line-height-medium)
          var(--bb-font-family);
      }

      :host([active]) {
        transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1) 0.2s;
        opacity: 1;
        pointer-events: auto;
      }

      :host([error]) {
        background: var(--e-90);
        --text-color: var(--e-40);
      }

      .g-icon {
        flex: 0 0 auto;
        color: var(--text-color);
        margin-right: var(--bb-grid-size-4);

        &.rotate {
          animation: 1s linear 0s infinite normal forwards running rotate;
        }
      }

      #messages {
        color: var(--text-color);
        flex: 1 1 auto;
        margin-right: var(--bb-grid-size-11);

        a,
        a:visited {
          color: var(--bb-ui-600);
          text-decoration: none;

          &:hover {
            color: var(--bb-ui-500);
            text-decoration: underline;
          }
        }
      }

      #actions {
        flex: 0 1 auto;
        width: fit-content;
        margin-right: var(--bb-grid-size-3);

        & button {
          font: 500 var(--bb-body-medium) / var(--bb-body-line-height-medium)
            var(--bb-font-family);
          padding: 0;
          background: transparent;
          border: none;
          margin: 0 var(--bb-grid-size-4);
          color: var(--text-color);
          opacity: 0.7;
          transition: opacity 0.2s cubic-bezier(0, 0, 0.3, 1);

          &:not([disabled]) {
            cursor: pointer;

            &:hover,
            &:focus {
              opacity: 1;
            }
          }
        }
      }

      #close {
        display: flex;
        align-items: center;
        padding: 0;
        color: var(--text-color);
        background: transparent;
        border: none;
        margin: 0 0 0 var(--bb-grid-size-2);
        opacity: 0.7;
        transition: opacity 0.2s cubic-bezier(0, 0, 0.3, 1);

        .g-icon {
          margin-right: 0;
        }

        &:not([disabled]) {
          cursor: pointer;

          &:hover,
          &:focus {
            opacity: 1;
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

  show(message: SnackbarMessage, replaceAll = false) {
    const existingMessage = this.#messages.findIndex(
      (msg) => msg.id === message.id
    );
    if (existingMessage === -1) {
      if (replaceAll) {
        this.#messages.length = 0;
      }

      this.#messages.push(message);
    } else {
      this.#messages[existingMessage] = message;
    }

    window.clearTimeout(this.#timeout);
    if (!this.#messages.every((msg) => msg.persistent)) {
      this.#timeout = window.setTimeout(() => {
        this.hide();
      }, this.timeout);
    }

    this.error = this.#messages.some((msg) => msg.type === SnackType.ERROR);
    this.active = true;
    this.requestUpdate();

    return message.id;
  }

  hide(id?: SnackbarUUID) {
    if (id) {
      const idx = this.#messages.findIndex((msg) => msg.id === id);
      if (idx !== -1) {
        this.#messages.splice(idx, 1);
      }
    } else {
      this.#messages.length = 0;
    }

    this.active = this.#messages.length !== 0;
    this.updateComplete.then((avoidedUpdate) => {
      if (!avoidedUpdate) {
        return;
      }

      this.requestUpdate();
    });
  }

  render() {
    let rotate = false;
    let icon = "";
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      if (
        !this.#messages[i].type ||
        this.#messages[i].type === SnackType.NONE
      ) {
        continue;
      }

      icon = this.#messages[i].type;
      if (this.#messages[i].type === SnackType.PENDING) {
        icon = "progress_activity";
        rotate = true;
      }
      break;
    }

    return html` ${icon
        ? html`<span
            class=${classMap({
              "g-icon": true,
              round: true,
              filled: true,
              rotate,
            })}
            >${icon}</span
          >`
        : nothing}
      <div id="messages">
        ${repeat(
          this.#messages,
          (message) => message.id,
          (message) => {
            return html`<div>${message.message}</div>`;
          }
        )}
      </div>
      <div id="actions">
        ${repeat(
          this.#messages,
          (message) => message.id,
          (message) => {
            if (!message.actions) {
              return nothing;
            }

            return html`${repeat(
              message.actions,
              (action) => action.value,
              (action) => {
                return html`<button
                  @click=${() => {
                    this.hide();
                    this.dispatchEvent(
                      new SnackbarActionEvent(
                        action.action,
                        action.value,
                        action.callback
                      )
                    );
                  }}
                >
                  ${action.title}
                </button>`;
              }
            )}`;
          }
        )}
      </div>
      <button
        id="close"
        @click=${() => {
          this.hide();
          this.dispatchEvent(new SnackbarActionEvent("dismiss"));
        }}
      >
        <span class="g-icon">close</span>
      </button>`;
  }
}
