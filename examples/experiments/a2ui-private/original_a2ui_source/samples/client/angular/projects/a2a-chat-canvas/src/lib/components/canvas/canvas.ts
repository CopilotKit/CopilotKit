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

import { Renderer } from '@a2ui/angular';
import { InteractivityChecker } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { CanvasService } from '../../services/canvas-service';

/**
 * Component responsible for rendering A2UI content on a canvas.
 */
@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.html',
  styleUrl: './canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Renderer],
})
export class Canvas {
  /** Service for managing the canvas state. */
  private readonly canvasService = inject(CanvasService);

  /** The A2UI component nodes to be rendered in the canvas. */
  protected readonly canvasContents = computed(() => this.canvasService.contents());
  /** The ID of the current A2UI surface being displayed. */
  protected readonly surfaceId = computed(() => this.canvasService.surfaceId());

  private readonly rootElement = viewChild.required<ElementRef<HTMLElement>>('rootElement');
  private readonly interactivityChecker = inject(InteractivityChecker);

  /**
   * Focuses the first interactable element in the canvas, or the canvas itself
   * if no elements can be found.
   */
  focusFirstInteractableElement() {
    const descendants = this.rootElement().nativeElement.querySelectorAll('*');
    for (const descendant of descendants) {
      if (descendant instanceof HTMLElement && this.interactivityChecker.isFocusable(descendant)) {
        descendant.focus();
        return;
      }
    }
    this.rootElement().nativeElement.focus();
  }
}
