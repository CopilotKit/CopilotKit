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

import { Component, computed, inject, input } from '@angular/core';
import { DynamicComponent } from '../rendering/dynamic-component';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { MarkdownRenderer } from '../data/markdown';

@Component({
  selector: 'a2ui-text',
  template: `
    <section
      [class]="classes()"
      [style]="theme.additionalStyles?.Text"
      [innerHTML]="resolvedText()"
    ></section>
  `,
  styles: `
    :host {
      display: block;
      flex: var(--weight);
    }
  `,
})
export class Text extends DynamicComponent {
  private markdownRenderer = inject(MarkdownRenderer);
  readonly text = input.required<v0_8.Primitives.StringValue | null>();
  readonly usageHint = input.required<v0_8.Types.ResolvedText['usageHint'] | null>();

  protected resolvedText = computed(() => {
    const usageHint = this.usageHint();
    let value = super.resolvePrimitive(this.text());

    if (value == null) {
      return '(empty)';
    }

    switch (usageHint) {
      case 'h1':
        value = `# ${value}`;
        break;
      case 'h2':
        value = `## ${value}`;
        break;
      case 'h3':
        value = `### ${value}`;
        break;
      case 'h4':
        value = `#### ${value}`;
        break;
      case 'h5':
        value = `##### ${value}`;
        break;
      case 'caption':
        value = `*${value}*`;
        break;
      default:
        value = String(value);
        break;
    }

    return this.markdownRenderer.render(
      value,
      v0_8.Styles.appendToAll(this.theme.markdown, ['ol', 'ul', 'li'], {}),
    );
  });

  protected classes = computed(() => {
    const usageHint = this.usageHint();

    return v0_8.Styles.merge(
      this.theme.components.Text.all,
      usageHint ? this.theme.components.Text[usageHint] : {},
    );
  });
}
