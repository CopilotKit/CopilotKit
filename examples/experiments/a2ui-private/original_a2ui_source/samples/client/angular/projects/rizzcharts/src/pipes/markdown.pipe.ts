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

import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import markdownit from 'markdown-it';

@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly md = markdownit({
    html: false,
    linkify: true,
    typographer: true,
  });

  constructor() {
    this.configureRenderer();
  }

  transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }
    const rendered = this.md.render(value);
    return this.sanitizer.bypassSecurityTrustHtml(rendered);
  }

  private configureRenderer() {
    // Open links in new tab
    const defaultLinkOpenRender =
      this.md.renderer.rules['link_open'] ||
      ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    this.md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpenRender(tokens, idx, options, env, self);
    };
  }
}
