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
import { classMap } from "lit/directives/class-map.js";
import { createRef, ref, Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { EnumValue } from "../types/types";
import { v0_8 } from "@a2ui/web-lib";

@customElement("item-select")
export class ItemSelect extends LitElement {
  @property({ reflect: true, type: Boolean })
  accessor transparent = false;

  @property()
  accessor heading: string | null = null;

  @property({ reflect: true, type: String })
  accessor alignment: "top" | "bottom" = "bottom";

  @property()
  accessor freezeValue = -1;

  @property({ reflect: true, type: Boolean })
  accessor showDownArrow = true;

  @property()
  accessor autoActivate = false;

  @property()
  set values(values: EnumValue[]) {
    this.#values = values;
    if (this.#value) {
      this.#selected = this.#values.findIndex((v) => v.id === this.#value);
      if (this.#selected === -1) {
        this.#selected = 0;
      }
      this.#highlighted = this.#selected;
    } else {
      this.#selected = 0;
      this.#highlighted = 0;
    }
  }
  get values() {
    return this.#values;
  }

  @property()
  set value(value: string) {
    this.#value = value;
    this.#selected = this.#values.findIndex((v) => v.id === value);
    if (this.#selected === -1) {
      // If none selected, find first non-hidden value.
      this.#selected = this.#values.findIndex((v) => !v.hidden);
      if (this.#selected === -1) {
        console.warn(
          `Couldn't find any non-hidden values in item selector`,
          this.#values
        );
        this.#selected = 0;
      }
    }
    this.#highlighted = this.#selected;
  }
  get value() {
    return this.#values[this.#selected]?.id ?? "";
  }

  static styles = [
    unsafeCSS(v0_8.Styles.structuralStyles),
    css`
      :host {
        display: block;
        position: relative;

        --menu-width: 280px;
        --menu-item-column-gap: var(--bb-grid-size-3);
        --selected-item-column-gap: var(--bb-grid-size-3);
        --selected-item-height: var(--bb-grid-size-7);
        --selected-item-hover-color: transparent;
        --selected-item-border-radius: var(--bb-grid-size);
        --selected-item-font: normal var(--bb-label-medium) /
          var(--bb-label-line-height-medium) var(--bb-font-family);
        --selected-item-title-padding: 0;
        --selected-item-padding-left: var(--bb-grid-size-3);
        --selected-item-padding-right: var(--bb-grid-size-3);
      }

      :host([transparent]) {
        & button.selected {
          background-color: transparent;

          &:not([disabled]) {
            &:focus,
            &:hover {
              background-color: var(--selected-item-hover-color);
            }
          }
        }
      }

      :host([showdownarrow]) button.selected {
        grid-template-columns: minmax(0, 1fr) 20px;

        &.icon:not(.tag) {
          grid-template-columns: 20px minmax(0, 1fr) 20px;
        }
      }

      button {
        font-size: 14px;
        height: var(--bb-grid-size-11);
        border: none;
        background-color: transparent;
        text-align: left;
        transition: background-color 0.2s cubic-bezier(0, 0, 0.3, 1);
        color: var(--n-10);
        width: 100%;
        display: grid;
        align-items: center;
        padding-left: var(--bb-grid-size-3);
        padding-right: var(--bb-grid-size-3);

        &.tag {
          .i-tag {
            color: var(--bb-neutral-500);
          }
        }

        &.icon:not(.tag) {
          grid-template-columns: 20px minmax(0, 1fr);
        }

        &.tag:not(.icon) {
          grid-template-columns: minmax(0, 1fr) max-content;
        }

        &.tag.icon {
          grid-template-columns: 20px minmax(0, 1fr) max-content;
        }

        &:not([disabled]) {
          cursor: pointer;

          &.active {
            background-color: var(--n-95);
          }
        }

        &.double {
          height: var(--bb-grid-size-13);
          padding-top: var(--bb-grid-size-2);
          padding-bottom: var(--bb-grid-size-2);
        }

        & .title,
        & .description {
          white-space: nowrap;
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        & .title {
          font-weight: 500;
        }

        & .description {
          color: var(--bb-neutral-700);
          font: normal var(--bb-label-small) / var(--bb-label-line-height-small)
            var(--bb-font-family);
        }

        &.selected {
          background: var(--n-98);
          width: max-content;
          max-width: 100%;
          height: var(--selected-item-height);
          border-radius: var(--selected-item-border-radius);
          padding-left: var(--selected-item-padding-left);
          padding-right: var(--selected-item-padding-right);

          & .title {
            font: var(--selected-item-font);
            padding: var(--selected-item-title-padding);
          }

          &.icon .title {
            margin-left: var(--selected-item-column-gap);
          }

          &:not([disabled]) {
            &:hover,
            &:focus {
              background: var(--n-95);
            }
          }
        }
      }

      #item-selector {
        position: fixed;
        left: var(--left);
        background: var(--n-100);
        padding: 0;
        width: var(--menu-width);
        height: fit-content;
        margin: 0;
        border: none;
        overflow: auto;
        color: var(--n-10);
        border-radius: var(--bb-grid-size-3);
        box-shadow: 0px 4px 8px 3px rgba(0, 0, 0, 0.05),
          0px 1px 3px 0 rgba(0, 0, 0, 0.1);

        & .heading {
          color: var(--bb-neutral-500);
          font: normal var(--bb-label-small) / var(--bb-label-line-height-small)
            var(--bb-font-family);
          margin: var(--bb-grid-size-2) var(--bb-grid-size-3);
        }

        & menu {
          padding: 0;
          margin: 0;
          list-style: none;

          & li {
            margin-bottom: var(--bb-grid-size);

            &:last-of-type {
              margin-bottom: 0;
            }

            & button {
              outline: none;
              column-gap: var(--menu-item-column-gap);
            }
          }
        }

        &::backdrop {
          opacity: 0;
        }
      }

      :host([alignment="top"]) #item-selector {
        top: auto;
        bottom: var(--bottom);
      }

      :host([alignment="bottom"]) #item-selector {
        top: var(--top);
        bottom: auto;
      }
    `,
  ];

  #selected = 0;
  #highlighted = 0;
  #value = "";
  #values: EnumValue[] = [];
  #toggleRef: Ref<HTMLButtonElement> = createRef();
  #selectorRef: Ref<HTMLDialogElement> = createRef();

  #handleChange() {
    this.#selected = this.#highlighted;
    if (this.#selectorRef.value) {
      this.#selectorRef.value.close();
    }

    this.dispatchEvent(
      new Event("change", { bubbles: true, composed: true, cancelable: true })
    );
    this.requestUpdate();
  }

  protected firstUpdated(): void {
    if (!this.autoActivate) {
      return;
    }

    this.updateComplete.then(() => {
      if (!this.#selectorRef.value) {
        return;
      }

      this.#selectorRef.value.showModal();
    });
  }

  render() {
    const idx = this.freezeValue !== -1 ? this.freezeValue : this.#selected;
    const renderedValue = this.#values[idx] ?? {
      title: "No items available",
      value: "none",
      icon: "",
    };
    const classes: Record<string, boolean> = {
      selected: true,
      icon: renderedValue.icon !== undefined,
      round: true,
      "w-500": true,
      "sans-flex": true,
    };

    return html`${this.autoActivate
        ? nothing
        : html`<button
            class=${classMap(classes)}
            @click=${() => {
              if (!this.#selectorRef.value) {
                return;
              }

              this.#selectorRef.value.showModal();
            }}
            ${ref(this.#toggleRef)}
          >
            ${renderedValue.icon
              ? html`<span class="g-icon filled">${renderedValue.icon}</span>`
              : nothing}
            ${renderedValue.title
              ? html`<span class="title">${renderedValue.title}</span>`
              : nothing}
            ${this.showDownArrow
              ? html`<span class="g-icon filled">arrow_drop_down</span>`
              : nothing}
          </button>`}

      <dialog
        id="item-selector"
        modal
        popover
        ${ref(this.#selectorRef)}
        @keydown=${(evt: KeyboardEvent) => {
          const forwards =
            evt.key === "ArrowDown" || (evt.key === "Tab" && !evt.shiftKey);
          const backwards =
            evt.key === "ArrowUp" || (evt.key === "Tab" && evt.shiftKey);
          if (backwards && this.#highlighted > 0) {
            this.#highlighted--;
            this.requestUpdate();
          }

          if (forwards && this.#highlighted < this.values.length - 1) {
            this.#highlighted++;
            this.requestUpdate();
          }

          if (evt.key === "Enter") {
            evt.preventDefault();
            this.#handleChange();
          }
        }}
        @click=${(evt: PointerEvent) => {
          const [top] = evt.composedPath();
          if (top !== this.#selectorRef.value || !this.#selectorRef.value) {
            return;
          }

          this.#selectorRef.value.close();
          this.dispatchEvent(
            new Event("close", {
              cancelable: true,
              bubbles: true,
              composed: true,
            })
          );
        }}
        @beforetoggle=${(evt: ToggleEvent) => {
          this.#highlighted = this.#selected;
          this.requestUpdate();

          if (evt.newState === "closed") {
            return;
          }

          // Position this directly because the relevant CSS properties aren't
          // available everywhere yet.
          if (!this.#toggleRef.value) {
            return;
          }

          const bounds = this.#toggleRef.value.getBoundingClientRect();
          let { left, top, bottom } = bounds;
          if (left + 296 > window.innerWidth) {
            left = window.innerWidth - 296;
          }

          if (top + 420 > window.innerHeight) {
            top = window.innerHeight - 420;
          }

          const adjustment = bounds.height + 8;
          if (this.alignment === "bottom") {
            // Adjust to below the button.
            top += adjustment;
            this.style.setProperty("--top", `${top}px`);
          } else {
            // Adjust so that it's the distance from the viewport bottom.
            bottom = window.innerHeight - bottom + adjustment;
            this.style.setProperty("--bottom", `${bottom}px`);
          }
          this.style.setProperty("--left", `${left}px`);
        }}
      >
        ${this.heading
          ? html`<h1 class="heading">${this.heading}</h1>`
          : nothing}
        <menu>
          ${repeat(
            this.#values,
            (v) => v.id,
            (value, idx) => {
              if (value.hidden) {
                return nothing;
              }

              const classes: Record<string, boolean> = {
                double: value.description !== undefined,
                icon: value.icon !== undefined,
                tag: value.tag !== undefined,
                active: idx === this.#highlighted,
                round: true,
                "w-500": true,
                "sans-flex": true,
              };

              return html`<li>
                <button
                  ?autofocus=${idx === this.#highlighted}
                  @pointerover=${() => {
                    this.#highlighted = idx;
                    this.requestUpdate();
                  }}
                  @pointerdown=${() => {
                    this.#handleChange();
                  }}
                  class=${classMap(classes)}
                >
                  ${value.icon
                    ? html`<span class="g-icon filled">${value.icon}</span>`
                    : nothing}
                  <span>
                    <span class="title">${value.title}</span>

                    ${value.description
                      ? html`<span class="description"
                          >${value.description}</span
                        >`
                      : nothing}
                  </span>
                  ${value.tag
                    ? html`<span class="i-tag">${value.tag}</span>`
                    : nothing}
                </button>
              </li>`;
            }
          )}
        </menu>
      </dialog>`;
  }
}
