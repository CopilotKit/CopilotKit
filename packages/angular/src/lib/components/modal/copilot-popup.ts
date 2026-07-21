import { CdkTrapFocus } from "@angular/cdk/a11y";
import { NgComponentOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Type,
  afterNextRender,
  computed,
  input,
  model,
  viewChild,
} from "@angular/core";
import { randomUUID } from "@copilotkit/shared";

import { CopilotChat } from "../chat/copilot-chat";
import { dimensionToCss } from "./modal-utils";

/** Accessible, responsive floating chat surface with an explicit open model. */
@Component({
  selector: "copilot-popup",
  imports: [CdkTrapFocus, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "copilot-popup-host", "data-copilotkit": "" },
  template: `
    <button
      #launcher
      type="button"
      class="copilot-modal-toggle"
      data-copilot-popup-toggle
      [attr.aria-controls]="dialogId"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="open() ? 'Close Copilot chat' : 'Open Copilot chat'"
      [tabIndex]="open() ? -1 : 0"
      (click)="toggle()"
    >
      <span aria-hidden="true">{{ open() ? "×" : "✦" }}</span>
    </button>

    @if (open()) {
      <div
        class="copilot-modal-backdrop"
        data-copilot-popup-backdrop
        aria-hidden="true"
        (click)="closeFromBackdrop()"
      ></div>
      <section
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="copilot-popup-window copilotKitPopup"
        role="dialog"
        aria-modal="true"
        [attr.id]="dialogId"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? title() : null"
        [style.--copilot-popup-width]="resolvedWidth()"
        [style.--copilot-popup-height]="resolvedHeight()"
        (keydown.escape)="close()"
      >
        <header class="copilot-modal-header">
          @if (headerComponent(); as header) {
            <ng-container [ngComponentOutlet]="header" />
          } @else {
            <h2 [attr.id]="titleId">{{ title() }}</h2>
          }
          <button
            #initialFocus
            type="button"
            cdkFocusInitial
            aria-label="Close Copilot chat"
            (click)="close()"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="copilot-modal-chat">
          <ng-container [ngComponentOutlet]="chatComponent()" />
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .copilot-modal-toggle {
      position: fixed;
      right: max(1.5rem, env(safe-area-inset-right));
      bottom: max(1.5rem, env(safe-area-inset-bottom));
      z-index: 1202;
      display: grid;
      width: 3.25rem;
      height: 3.25rem;
      place-items: center;
      border: 0;
      border-radius: 999px;
      color: white;
      background: #111827;
      box-shadow: 0 12px 30px rgb(15 23 42 / 24%);
      cursor: pointer;
    }
    .copilot-modal-toggle:focus-visible,
    .copilot-modal-header button:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 3px;
    }
    .copilot-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1200;
      background: rgb(15 23 42 / 24%);
    }
    .copilot-popup-window {
      position: fixed;
      right: max(1.5rem, env(safe-area-inset-right));
      bottom: max(6rem, calc(4.5rem + env(safe-area-inset-bottom)));
      z-index: 1201;
      display: grid;
      width: min(var(--copilot-popup-width), calc(100vw - 3rem));
      height: min(var(--copilot-popup-height), calc(100dvh - 7.5rem));
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: 1px solid #dbe3eb;
      border-radius: 1rem;
      color: #111827;
      background: white;
      box-shadow: 0 24px 60px rgb(15 23 42 / 28%);
    }
    .copilot-modal-header {
      display: flex;
      min-height: 3.5rem;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .copilot-modal-header h2 {
      margin: 0;
      font-size: 1rem;
    }
    .copilot-modal-header button {
      border: 0;
      color: inherit;
      background: transparent;
      font-size: 1.5rem;
      cursor: pointer;
    }
    .copilot-modal-chat {
      min-height: 0;
      overflow: hidden;
    }
    @media (max-width: 47.999rem) {
      .copilot-popup-window {
        inset: 0;
        width: 100%;
        height: 100dvh;
        border: 0;
        border-radius: 0;
        padding: env(safe-area-inset-top) env(safe-area-inset-right)
          env(safe-area-inset-bottom) env(safe-area-inset-left);
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .copilot-popup-window {
        animation: copilot-popup-enter 180ms ease-out;
      }
      @keyframes copilot-popup-enter {
        from {
          opacity: 0;
          transform: translateY(1rem) scale(0.98);
        }
      }
    }
  `,
})
export class CopilotPopup {
  readonly open = model(true);
  readonly title = input("Copilot");
  readonly width = input<number | string>(420);
  readonly height = input<number | string>(560);
  readonly clickOutsideToClose = input(false);
  readonly chatComponent = input<Type<unknown>>(CopilotChat);
  readonly headerComponent = input<Type<unknown> | undefined>();

  protected readonly dialogId = `copilot-popup-${randomUUID()}`;
  protected readonly titleId = `${this.dialogId}-title`;
  protected readonly resolvedWidth = computed(() =>
    dimensionToCss(this.width(), 420),
  );
  protected readonly resolvedHeight = computed(() =>
    dimensionToCss(this.height(), 560),
  );
  private readonly launcher =
    viewChild.required<ElementRef<HTMLButtonElement>>("launcher");
  private readonly initialFocus =
    viewChild<ElementRef<HTMLButtonElement>>("initialFocus");

  constructor() {
    afterNextRender(() => {
      if (this.open()) this.focusModal();
    });
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else {
      this.open.set(true);
      queueMicrotask(() => this.focusModal());
    }
  }

  protected closeFromBackdrop(): void {
    if (this.clickOutsideToClose()) this.close();
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    queueMicrotask(() =>
      this.launcher().nativeElement.focus({ preventScroll: true }),
    );
  }

  private focusModal(): void {
    this.initialFocus()?.nativeElement.focus({ preventScroll: true });
  }
}
