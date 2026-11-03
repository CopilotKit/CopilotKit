import { NgComponentOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  input,
  type Type,
} from "@angular/core";
import { ɵA2UI_LIFECYCLE_TEXT } from "@copilotkit/core";
import type { ɵA2UIActivitySnapshot } from "@copilotkit/core";
import { CopilotA2UIProgress } from "./a2ui-progress";

/**
 * @internal
 * Draws the pre-paint lifecycle state from core's `ɵA2UIActivityController`
 * snapshot: the failure card, the host's loading component while building, or
 * the progress skeleton with optional debug details.
 */
@Component({
  selector: "copilot-a2ui-lifecycle-view",
  imports: [CopilotA2UIProgress, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let state = snapshot();
    @if (state.lifecycle.status === "failed") {
      <section class="failure" role="status" data-testid="a2ui-failure">
        <strong>{{ text.failureTitle }}</strong>
        <p>{{ text.failureDescription }}</p>
        @if (state.showDebugDetails) {
          <details [attr.open]="state.debugDetailsOpen ? '' : null">
            <summary>{{ state.debugDetailsLabel }}</summary>
            <pre>{{ state.debugPayload }}</pre>
          </details>
        }
      </section>
    } @else if (state.lifecycle.status === "building" && loadingComponent()) {
      <ng-container *ngComponentOutlet="loadingComponent()!" />
    } @else {
      <copilot-a2ui-progress
        [phase]="state.progressPhase"
        [tokens]="state.lifecycle.progressTokens ?? 0"
        [label]="state.label"
      />
      @if (state.showDebugDetails) {
        <details
          class="diagnostics"
          [attr.open]="state.debugDetailsOpen ? '' : null"
        >
          <summary>{{ state.debugDetailsLabel }}</summary>
          <pre>{{ state.debugPayload }}</pre>
        </details>
      }
    }
  `,
  styles: `
    .failure {
      margin-block: 0.75rem;
      max-width: 32rem;
      padding: 0.75rem;
      border: 1px solid #fde68a;
      border-radius: 0.5rem;
      color: #92400e;
      background: #fffbeb;
      font-size: 0.875rem;
    }
    .failure p {
      margin: 0.25rem 0 0;
      font-size: 0.75rem;
    }
    details {
      margin-top: 0.5rem;
      font-size: 0.75rem;
    }
    summary {
      cursor: pointer;
    }
    pre {
      max-height: 14rem;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .diagnostics {
      max-width: 32rem;
      color: #52525b;
    }
  `,
})
export class CopilotA2UILifecycleView {
  readonly snapshot = input.required<ɵA2UIActivitySnapshot>();
  /** Shown instead of the skeleton while the surface is building. */
  readonly loadingComponent = input<Type<unknown> | undefined>();

  protected readonly text = ɵA2UI_LIFECYCLE_TEXT;
}
