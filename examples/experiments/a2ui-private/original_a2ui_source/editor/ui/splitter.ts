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

import { LitElement, html, css, nothing, PropertyValueMap } from "lit";
import { customElement, property } from "lit/decorators.js";

export enum Direction {
  HORIZONTAL = "horizontal",
  VERTICAL = "vertical",
}

const STORAGE_PREFIX = "ui-split";

@customElement("ui-splitter")
export class Splitter extends LitElement {
  @property({ reflect: true, attribute: true })
  accessor direction = Direction.HORIZONTAL;

  @property({ reflect: true, attribute: true })
  accessor name = "";

  @property({ reflect: true, attribute: true, type: "number" })
  accessor minSegmentSizeHorizontal = 325;

  @property({ reflect: true, attribute: true, type: "number" })
  accessor minSegmentSizeVertical = 200;

  @property({
    reflect: true,
    attribute: true,
    type: Array,
    hasChanged(value) {
      if (!Array.isArray(value) || value.length < 2) {
        console.warn(
          `A splitter needs two or more sections; ${JSON.stringify(
            value
          )} was provided`
        );
        return false;
      }

      return true;
    },
  })
  accessor split = [0.5, 0.5];

  #handleIdx: number | null = null;
  #bounds = new DOMRect(0, 0, 0, 0);
  #onPointerMoveBound = this.#onPointerMove.bind(this);
  #onPointerUpBound = this.#onPointerUp.bind(this);
  #isMovingAutomatically = false;
  #minSizeNormalized = 0.1;

  static styles = css`
    :host {
      display: grid;
      grid-auto-rows: minmax(0, 1fr);
      overflow: auto;
      --handle-size: 16px;
      position: relative;
      container-type: size;
      contain: strict;
    }

    .drag-handle {
      z-index: 10;
      position: relative;
    }

    :host([direction="horizontal"].active) {
      cursor: ew-resize;
    }

    :host([direction="vertical"].active) {
      cursor: ns-resize;
    }

    :host([direction="horizontal"]) .drag-handle {
      cursor: ew-resize;
      width: var(--handle-size);
      translate: calc(var(--handle-size) * -0.5) 0;
    }

    :host([direction="vertical"]) .drag-handle {
      cursor: ns-resize;
      height: var(--handle-size);
      translate: 0 calc(var(--handle-size) * -0.5);
    }
  `;

  #resizeObserver = new ResizeObserver((entries) => {
    if (entries.length === 0) {
      return;
    }

    const [entry] = entries;
    if (this.direction === Direction.HORIZONTAL) {
      this.#minSizeNormalized =
        this.minSegmentSizeHorizontal / entry.contentRect.width;
    } else {
      this.#minSizeNormalized =
        this.minSegmentSizeVertical / entry.contentRect.height;
    }

    this.#setAndStore();
  });

  connectedCallback(): void {
    super.connectedCallback();

    this.#resizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    this.#resizeObserver.disconnect();
  }

  #setAndStore() {
    if (this.name) {
      globalThis.sessionStorage.setItem(
        `${STORAGE_PREFIX}-${this.name}`,
        JSON.stringify(this.split)
      );
    }

    this.#updateStyles();
  }

  #onPointerDown(evt: PointerEvent) {
    if (this.#isMovingAutomatically) {
      return;
    }

    const [handle] = evt.composedPath();
    if (!(handle instanceof HTMLElement)) {
      return;
    }

    const idx = Number.parseInt(handle.dataset.idx || "");
    if (Number.isNaN(idx)) {
      return;
    }

    this.#handleIdx = idx;
    const top = this.children[this.#handleIdx];
    const bottom = this.children[this.#handleIdx + 1];

    if (!top || !bottom) {
      return;
    }

    const start = top.getBoundingClientRect();
    const end = bottom.getBoundingClientRect();

    this.#bounds.x = Math.min(start.x, end.x);
    this.#bounds.y = Math.min(start.y, end.y);
    this.#bounds.width = end.right - start.left;
    this.#bounds.height = end.bottom - start.top;

    this.style.userSelect = "none";
    this.classList.add("active");

    handle.setPointerCapture(evt.pointerId);
    window.addEventListener("pointermove", this.#onPointerMoveBound);
    window.addEventListener("pointerup", this.#onPointerUpBound, {
      once: true,
    });
  }

  #onPointerMove(evt: PointerEvent) {
    if (this.#handleIdx === null) {
      return;
    }

    let x = (evt.pageX - this.#bounds.x) / this.#bounds.width;
    let y = (evt.pageY - this.#bounds.y) / this.#bounds.height;

    const total = this.split[this.#handleIdx] + this.split[this.#handleIdx + 1];
    switch (this.direction) {
      case Direction.HORIZONTAL: {
        x = this.#clamp(
          x,
          this.#minSizeNormalized,
          1 - this.#minSizeNormalized
        );
        this.split[this.#handleIdx] = x * total;
        this.split[this.#handleIdx + 1] = (1 - x) * total;
        break;
      }

      case Direction.VERTICAL: {
        y = this.#clamp(
          y,
          this.#minSizeNormalized,
          1 - this.#minSizeNormalized
        );
        this.split[this.#handleIdx] = y * total;
        this.split[this.#handleIdx + 1] = (1 - y) * total;
        break;
      }
    }

    this.#setAndStore();
  }

  #onPointerUp() {
    this.#handleIdx = null;
    this.style.userSelect = "initial";
    this.classList.remove("active");

    window.removeEventListener("pointermove", this.#onPointerMoveBound);
  }

  #clamp(value: number, min: number, max: number) {
    if (value < min) {
      value = min;
    }

    if (value > max) {
      value = max;
    }

    return value;
  }

  firstUpdated() {
    if (!this.name) {
      console.warn("Splitter has no name; it won't have any values stored.");
      return;
    }

    const split = globalThis.sessionStorage.getItem(
      `${STORAGE_PREFIX}-${this.name}`
    );
    if (split) {
      const numSplit: number[] = JSON.parse(split) as number[];
      if (Array.isArray(numSplit)) {
        if (numSplit.length === this.split.length) {
          for (let i = 0; i < numSplit.length; i++) {
            this.split[i] = numSplit[i];
          }
        } else {
          console.warn(
            "Stored splitter value differs from configured value - resetting"
          );
          globalThis.sessionStorage.removeItem(
            `${STORAGE_PREFIX}-${this.name}`
          );
        }
      }
    }

    this.#updateStyles();
  }

  #updateStyles() {
    // Here we take a copy of the actual split values and we clamp them.
    // We do so by stepping through each item in the split. We accumulate the
    // delta for each item that is smaller than the minimum size, so that we
    // know how much we'd need to "borrow" from the other segments to make it
    // work. We then adjust each of the items that are too small up to the
    // minimum size.
    const split = [...this.split];
    const borrowable: number[] = [];
    let amountToBeBorrowed = 0;
    for (let s = 0; s < split.length; s++) {
      if (split[s] < this.#minSizeNormalized) {
        amountToBeBorrowed += this.#minSizeNormalized - split[s];
        split[s] = this.#minSizeNormalized;
        continue;
      }

      borrowable.push(s);
    }

    if (amountToBeBorrowed > 0) {
      // Now we go through all the other segments from which we determined that
      // we could borrow. We reduce each one by a fractional amount of the total.
      const totalBorrowable = borrowable.reduce(
        (prev, curr) => prev + split[curr],
        0
      );
      for (let s = 0; s < borrowable.length; s++) {
        const proportion =
          (split[borrowable[s]] / totalBorrowable) * amountToBeBorrowed;

        // Now ensure that the borrowed item never dips below the min size,
        // either. This could result in competition at very small spaces.
        split[borrowable[s]] = this.#clamp(
          this.split[borrowable[s]] - proportion,
          this.#minSizeNormalized,
          1
        );
      }
    }

    // Finally, we normalize the split to make sure it never exceeds 1.
    const total = split.reduce((prev, curr) => prev + curr, 0);
    for (let s = 0; s < split.length; s++) {
      split[s] = split[s] / total;
    }

    // And apply.
    const styles = split.map((_, idx) => `var(--slot-${idx})`).join(` 0px `);
    switch (this.direction) {
      case Direction.VERTICAL: {
        this.style.gridTemplateColumns = "";
        this.style.gridTemplateRows = styles;
        break;
      }

      case Direction.HORIZONTAL: {
        this.style.gridTemplateRows = "";
        this.style.gridTemplateColumns = styles;
        break;
      }
    }

    for (let idx = 0; idx < split.length; idx++) {
      const splitAmount = split[idx];
      this.style.setProperty(`--slot-${idx}`, `${splitAmount}fr`);
    }
  }

  protected willUpdate(
    changedProperties:
      | PropertyValueMap<{ direction: Direction }>
      | Map<PropertyKey, unknown>
  ): void {
    if (!changedProperties.has("direction")) {
      return;
    }

    this.#updateStyles();
  }

  render() {
    return html`${this.split.map((_, idx) => {
      const handle =
        idx < this.split.length - 1
          ? html`<div
              @pointerdown=${this.#onPointerDown}
              class="drag-handle"
              data-idx="${idx}"
            ></div>`
          : nothing;
      return html`<slot name="slot-${idx}"></slot>${handle}`;
    })}`;
  }
}
