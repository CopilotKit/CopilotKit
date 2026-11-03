import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
  untracked,
} from "@angular/core";
import { ɵA2UIActivityController, ɵreadA2UILifecycle } from "@copilotkit/core";
import type {
  ɵA2UIActivitySnapshot,
  ɵA2UIDebugExposure,
  ɵA2UILifecycle,
  ɵA2UILifecycleStatus,
} from "@copilotkit/core";
import type { A2UIRecoveryOptions } from "../../config";
import { explicitEffect } from "../../explicit-effect";
import { CopilotA2UILifecycleView } from "./a2ui-lifecycle-view";
import { injectA2UIControllerScheduling } from "./a2ui-scheduling";

export type A2UIDebugExposure = ɵA2UIDebugExposure;
export type A2UILifecycleStatus = ɵA2UILifecycleStatus;
export type A2UILifecycleContent = ɵA2UILifecycle;

/** Read only the server-owned A2UI lifecycle fields from activity content. */
export const readA2UILifecycleContent = ɵreadA2UILifecycle;

/** Pre-paint building, retry, and failure UI for a stable A2UI activity. */
@Component({
  selector: "copilot-a2ui-recovery",
  imports: [CopilotA2UILifecycleView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-a2ui-lifecycle-view [snapshot]="snapshot()" />
  `,
})
export class CopilotA2UIRecovery {
  readonly content = input.required<unknown>();
  readonly options = input<A2UIRecoveryOptions | undefined>();

  protected readonly snapshot = signal<ɵA2UIActivitySnapshot>(
    new ɵA2UIActivityController().getSnapshot(),
  );
  #controller: ɵA2UIActivityController | undefined;

  constructor() {
    const scheduling = injectA2UIControllerScheduling();
    // New options need a new controller, fed the current content.
    explicitEffect(this.options, (options, onCleanup) => {
      const controller = new ɵA2UIActivityController({
        ...scheduling,
        recovery: options,
      });
      const unsubscribe = controller.subscribe(() =>
        this.snapshot.set(controller.getSnapshot()),
      );
      this.#controller = controller;
      controller.setContent(untracked(this.content));
      this.snapshot.set(controller.getSnapshot());
      onCleanup(() => {
        unsubscribe();
        controller.dispose();
      });
    });
    explicitEffect(this.content, (content) =>
      this.#controller?.setContent(content),
    );
  }
}
