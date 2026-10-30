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
import { COPILOT_CHAT_WELCOME_LAYOUT } from "../chat/copilot-chat-welcome-layout";
import { CopilotKitStyles } from "../copilot-kit-styles";
import { CopilotIcon, MessageCircle, X } from "../icons/copilot-icon";
import { dimensionToCss } from "./modal-utils";

/** Accessible, responsive floating chat surface with an explicit open model. */
@Component({
  selector: "copilot-popup",
  imports: [CdkTrapFocus, NgComponentOutlet, CopilotIcon, CopilotKitStyles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [{ provide: COPILOT_CHAT_WELCOME_LAYOUT, useValue: "popup" }],
  host: { class: "copilot-popup-host", "data-copilotkit": "" },
  template: `
    <copilot-kit-styles />
    <button
      #launcher
      type="button"
      class="copilotKitButton cpk-chat-toggle-button"
      data-copilot-popup-toggle
      [attr.data-state]="open() ? 'open' : 'closed'"
      [attr.aria-controls]="dialogId"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="open() ? 'Close Copilot chat' : 'Open Copilot chat'"
      [tabIndex]="open() ? -1 : 0"
      (click)="toggle()"
    >
      <span
        aria-hidden="true"
        class="cpk-chat-toggle-button-icon-wrapper copilot-toggle-icon"
        [class.copilot-toggle-icon-hidden]="open()"
      >
        <copilot-icon
          [img]="MessageCircleIcon"
          iconClass="cpk-chat-toggle-button-icon"
        />
      </span>
      <span
        aria-hidden="true"
        class="cpk-chat-toggle-button-icon-wrapper copilot-toggle-icon copilot-toggle-icon-close"
        [class.copilot-toggle-icon-hidden]="!open()"
      >
        <copilot-icon [img]="XIcon" iconClass="cpk-chat-toggle-button-icon" />
      </span>
    </button>

    @if (open()) {
      <div
        class="copilot-modal-backdrop"
        data-copilot-popup-backdrop
        aria-hidden="true"
        (click)="closeFromBackdrop()"
      ></div>
      <div data-copilotkit class="cpk-popup-view">
        <section
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          class="copilotKitPopup copilotKitWindow cpk-popup-view-window cpk-popup-view-window-open"
          role="dialog"
          aria-modal="true"
          [attr.id]="dialogId"
          [attr.aria-labelledby]="headerComponent() ? null : titleId"
          [attr.aria-label]="headerComponent() ? title() : null"
          [style.--copilot-popup-width]="resolvedWidth()"
          [style.--copilot-popup-height]="resolvedHeight()"
          (keydown.escape)="close()"
        >
          <header class="copilotKitHeader cpk-modal-header">
            <div class="cpk-modal-header-content">
              <div class="cpk-modal-header-start">
                <span aria-hidden="true"></span>
              </div>
              <div class="cpk-modal-header-center">
                @if (headerComponent(); as header) {
                  <ng-container [ngComponentOutlet]="header" />
                } @else {
                  <h2 class="cpk-modal-header-title" [attr.id]="titleId">
                    {{ title() }}
                  </h2>
                }
              </div>
              <div class="cpk-modal-header-end">
                <button
                  #initialFocus
                  type="button"
                  cdkFocusInitial
                  class="cpk-modal-header-close-button"
                  aria-label="Close Copilot chat"
                  (click)="close()"
                >
                  <copilot-icon
                    [img]="XIcon"
                    iconClass="cpk-modal-header-close-icon"
                  />
                </button>
              </div>
            </div>
          </header>
          <div class="cpk-popup-view-chat" data-popup-chat>
            <ng-container [ngComponentOutlet]="chatComponent()" />
          </div>
        </section>
      </div>
    }
  `,
  // The look comes from the shared CSS (cpk-* classes). These rules add what
  // the Angular popup does beyond React's: a backdrop that catches outside
  // clicks, a toggle that stays on top of it, and an enter animation.
  styles: `
    :host {
      display: contents;
    }
    .cpk-chat-toggle-button {
      z-index: 1202;
    }
    .copilot-toggle-icon {
      transition:
        opacity 200ms cubic-bezier(0, 0, 0.2, 1),
        transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }
    .copilot-toggle-icon-hidden {
      opacity: 0;
      transform: scale(0.75) rotate(90deg);
    }
    .copilot-toggle-icon-close.copilot-toggle-icon-hidden {
      transform: scale(0.75) rotate(-90deg);
    }
    .copilot-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1200;
    }
    .cpk-popup-view {
      z-index: 1201;
    }
    .cpk-popup-view-window {
      --copilot-popup-max-width: calc(100vw - 3rem);
      --copilot-popup-max-height: calc(100dvh - 7.5rem);
      padding: env(safe-area-inset-top) env(safe-area-inset-right)
        env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    @media (prefers-reduced-motion: no-preference) {
      .cpk-popup-view-window {
        animation: copilot-popup-enter 200ms cubic-bezier(0, 0, 0.2, 1);
      }
      @keyframes copilot-popup-enter {
        from {
          translate: 0 1.25rem;
          scale: 0.95;
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

  protected readonly MessageCircleIcon = MessageCircle;
  protected readonly XIcon = X;

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
