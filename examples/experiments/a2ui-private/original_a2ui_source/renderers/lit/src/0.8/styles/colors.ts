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

import { PaletteKey, PaletteKeyVals, shades } from "../types/colors.js";
import { toProp } from "./utils.js";

const color = <C extends PaletteKeyVals>(src: PaletteKey<C>) =>
  `
    ${src
      .map((key: string) => {
        return `.color-bc-${key} { border-color: var(${toProp(key)}); }`;
      })
      .join("\n")}

    ${src
      .map((key: string) => {
        const vals = [
          `.color-bgc-${key} { background-color: var(${toProp(key)}); }`,
          `.color-bbgc-${key}::backdrop { background-color: var(${toProp(
            key
          )}); }`,
        ];

        for (let o = 0.1; o < 1; o += 0.1) {
          vals.push(`.color-bbgc-${key}_${(o * 100).toFixed(0)}::backdrop {
            background-color: oklch(from var(${toProp(
              key
            )}) l c h / calc(alpha * ${o.toFixed(1)}) );
          }
        `);
        }

        return vals.join("\n");
      })
      .join("\n")}

  ${src
    .map((key: string) => {
      return `.color-c-${key} { color: var(${toProp(key)}); }`;
    })
    .join("\n")}
  `;

const keyFactory = <K extends PaletteKeyVals>(prefix: K) => {
  return shades.map((v) => `${prefix}${v}`) as PaletteKey<K>;
};

export const colors = [
  color(keyFactory("p")),
  color(keyFactory("s")),
  color(keyFactory("t")),
  color(keyFactory("n")),
  color(keyFactory("nv")),
  color(keyFactory("e")),
  `
    .color-bgc-transparent {
      background-color: transparent;
    }
  `,
];
