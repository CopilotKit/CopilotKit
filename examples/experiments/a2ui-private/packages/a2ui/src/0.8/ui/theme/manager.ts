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

export class ThemeManager {
  static #sheets: CSSStyleSheet[] = [];
  static #listeners: Set<(sheets: CSSStyleSheet[]) => void> = new Set();

  /**
   * Registers a global CSS string to be applied to all A2UI components.
   */
  static register(cssContent: string) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssContent);
    this.#sheets.push(sheet);
    this.#notify();
  }

  static subscribe(listener: (sheets: CSSStyleSheet[]) => void) {
    this.#listeners.add(listener);
    listener(this.#sheets); // Initial call
    return () => this.#listeners.delete(listener);
  }

  static #notify() {
    for (const listener of this.#listeners) {
      listener(this.#sheets);
    }
  }
}
