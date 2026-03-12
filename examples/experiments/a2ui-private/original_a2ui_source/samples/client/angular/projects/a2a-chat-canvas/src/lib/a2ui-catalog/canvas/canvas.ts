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

import { CanvasService } from '@a2a_chat_canvas/services/canvas-service';
import { DynamicComponent } from '@a2ui/angular';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { Component, computed, inject, OnInit } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCard, MatCardContent } from '@angular/material/card';

/**
 * A2UI custom component for a Canvas.
 * This component interacts with the CanvasService to open and display its children components
 * in the ChatCanvas.
 */
@Component({
  selector: 'a2ui-canvas',
  templateUrl: './canvas.html',
  styleUrl: './canvas.scss',
  imports: [MatButton, MatCard, MatCardContent],
})
export class Canvas extends DynamicComponent<v0_8.Types.CustomNode> implements OnInit {
  /** Service for managing the canvas state. */
  private readonly canvasService = inject(CanvasService);

  /** Whether this specific canvas instance is the one currently opened in the ChatCanvas. */
  readonly isCanvasOpened = computed(() => this.canvasService.surfaceId() === this.surfaceId());

  /** When the component initializes, open this canvas in the ChatCanvas. */
  ngOnInit(): void {
    this.openCanvas();
  }

  /** Closes the canvas. */
  protected closeCanvas() {
    this.canvasService.surfaceId.set(null);
  }

  /** Opens this canvas in the ChatCanvas. */
  protected openCanvas() {
    this.canvasService.openSurfaceInCanvas(
      this.surfaceId()!,
      this.component().properties['children'] as v0_8.Types.AnyComponentNode[],
    );
  }
}
