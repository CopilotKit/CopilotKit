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

import { DynamicComponent } from '@a2ui/angular';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { Component, computed, inject, OnInit } from '@angular/core';
import { CanvasService } from '@a2a_chat_canvas/services/canvas-service';

@Component({
  selector: 'a2ui-canvas',
  imports: [],
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      min-height: 0;
      overflow: auto;
    }

    section {
      display: flex;
      justify-content: space-between;
      flex-direction: row;
    }
  `,
  template: `<section></section>`,
})
export class Canvas extends DynamicComponent<v0_8.Types.CustomNode> implements OnInit {
  private readonly canvasService = inject(CanvasService);

  readonly isCanvasOpened = computed(() => this.canvasService.surfaceId() === this.surfaceId());

  ngOnInit(): void {
    this.openCanvas();
  }

  protected closeCanvas() {
    this.canvasService.surfaceId.set(null);
  }

  protected openCanvas() {
    this.canvasService.openSurfaceInCanvas(
      this.surfaceId()!,
      this.component().properties['children'] as v0_8.Types.AnyComponentNode[],
    );
  }
}
