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

import { inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarkdownRendererService } from '../interfaces/markdown-renderer-service';

/**
 * A markdown renderer that uses a default sanitizer to convert the markdown
 * to HTML, this does not result in any useful markdown rendering.
 */
export class SanitizerMarkdownRendererService implements MarkdownRendererService {
  private readonly sanitizer = inject(DomSanitizer);

  render(markdown: string): Promise<SafeHtml> {
    return Promise.resolve(this.sanitizer.bypassSecurityTrustHtml(markdown));
  }
}
