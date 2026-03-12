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

import { html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SurfaceID, Surface as SurfaceState } from "../types/types";
import { A2UIModelProcessor } from "../data/model-processor.js";
import { Root } from "./root.js";
import { styleMap } from "lit/directives/style-map.js";

@customElement("a2ui-surface")
export class Surface extends Root {
  @property()
  accessor surfaceId: SurfaceID | null = null;

  @property()
  accessor surface: SurfaceState | null = null;

  @property()
  accessor processor: A2UIModelProcessor | null = null;

  static styles = [
    css`
      :host {
        display: flex;
        min-height: 0;
        overflow: auto;
        max-height: 100%;
        flex-direction: column;
        gap: 16px;
      }

      #surface-logo {
        display: flex;
        justify-content: center;

        & img {
          width: 50%;
          max-width: 220px;
        }
      }

      a2ui-root {
        flex: 1;
      }
    `,
  ];

  #renderLogo() {
    if (!this.surface?.styles.logoUrl) {
      return nothing;
    }

    return html`<div id="surface-logo">
      <img src=${this.surface.styles.logoUrl} />
    </div>`;
  }

  #renderSurface() {
    const styles: Record<string, string> = {};
    if (this.surface?.styles) {
      for (const [key, value] of Object.entries(this.surface.styles)) {
        switch (key) {
          case "primaryColor": {
            for (let i = 0; i <= 100; i++) {
              styles[`--p-${i}`] = `color-mix(in srgb, ${value} ${
                100 - i
              }%, #fff ${i}%)`;
            }
            break;
          }

          case "font": {
            styles["--font-family"] = value;
            styles["--font-family-flex"] = value;
            break;
          }
        }
      }
    }

    return html`<a2ui-root
      style=${styleMap(styles)}
      .surfaceId=${this.surfaceId}
      .processor=${this.processor}
      .childComponents=${this.surface?.componentTree
        ? [this.surface.componentTree]
        : null}
    ></a2ui-root>`;
  }

  render() {
    if (!this.surface) {
      return nothing;
    }

    return html`${[this.#renderLogo(), this.#renderSurface()]}`;
  }
}
