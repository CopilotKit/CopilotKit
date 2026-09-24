import { Component, input, signal } from "@angular/core";
import type { ModalApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-modal",
  imports: [CopilotA2UIChild],
  template: `
    <div class="trigger" (click)="open.set(true)">
      <copilot-a2ui-child [child]="props().trigger" />
    </div>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)">
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          (click)="$event.stopPropagation()"
        >
          <div class="dialog-header">
            <button
              type="button"
              class="close"
              aria-label="Close"
              (click)="open.set(false)"
            >
              &times;
            </button>
          </div>
          <div class="dialog-content">
            <copilot-a2ui-child [child]="props().content" />
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .trigger {
      display: inline-block;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--a2ui-modal-z-index, 1000);
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--a2ui-modal-backdrop, rgba(0, 0, 0, 0.5));
    }
    .dialog {
      display: flex;
      flex-direction: column;
      max-width: 90%;
      max-height: 90%;
      overflow: auto;
      padding: var(--a2ui-modal-padding, 24px);
      border-radius: var(--a2ui-border-radius, 8px);
      background-color: var(--a2ui-color-surface, #fff);
    }
    .dialog-header {
      display: flex;
      justify-content: flex-end;
    }
    .close {
      padding: 4px;
      border: none;
      background: none;
      font-size: 20px;
      cursor: pointer;
    }
    .dialog-content {
      flex: 1;
    }
  `,
})
export class CopilotA2UIModal {
  readonly props = input.required<BasicProps<typeof ModalApi>>();
  protected readonly open = signal(false);
}
