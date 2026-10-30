import { CdkTrapFocus } from "@angular/cdk/a11y";
import { DOCUMENT, NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import type { ElementRef, Type } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { randomUUID } from "@copilotkit/shared";

import { CopilotChat } from "../chat/copilot-chat";
import { COPILOT_CHAT_WELCOME_LAYOUT } from "../chat/copilot-chat-welcome-layout";
import { CopilotKitStyles } from "../copilot-kit-styles";
import { CopilotIcon, MessageCircle, X } from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";
import { explicitEffect } from "../../explicit-effect";
import { DockedSidebarRegistry } from "./docked-sidebar-registry";
import { dimensionToCss } from "./modal-utils";

export type CopilotSidebarMode = "docked" | "overlay";
export type CopilotSidebarPosition = "left" | "right";

/** Responsive chat sidebar with independent overlay and single-owner docked modes. */
@Component({
  selector: "copilot-sidebar",
  imports: [
    CdkTrapFocus,
    NgComponentOutlet,
    NgTemplateOutlet,
    CopilotIcon,
    CopilotKitStyles,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [
    { provide: COPILOT_CHAT_WELCOME_LAYOUT, useValue: "sidebar" },
  ],
  host: { class: "copilot-sidebar-host", "data-copilotkit": "" },
  template: `
    <copilot-kit-styles />
    <button
      #launcher
      type="button"
      class="copilotKitButton cpk-chat-toggle-button"
      data-copilot-sidebar-toggle
      [class.cpk-sidebar-view-toggle-button-left]="position() === 'left'"
      [attr.data-state]="open() ? 'open' : 'closed'"
      [attr.aria-controls]="sidebarId"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="
        open() ? labels.chatToggleCloseLabel : labels.chatToggleOpenLabel
      "
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

    @if (open() && isModal()) {
      <div
        class="copilot-sidebar-backdrop"
        data-copilot-sidebar-backdrop
        aria-hidden="true"
        (click)="closeFromBackdrop()"
      ></div>
      <section
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        data-copilotkit
        class="copilotKitSidebar copilotKitWindow cpk-sidebar-view modal"
        data-copilot-sidebar
        role="dialog"
        aria-modal="true"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? resolvedTitle() : null"
        [style.--sidebar-width]="resolvedWidth()"
        (keydown.escape)="close()"
      >
        <ng-container [ngTemplateOutlet]="sidebarContents" />
      </section>
    } @else if (open() && dockAccepted()) {
      <aside
        data-copilotkit
        class="copilotKitSidebar copilotKitWindow cpk-sidebar-view docked"
        data-copilot-sidebar
        role="complementary"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? resolvedTitle() : null"
        [style.--sidebar-width]="resolvedWidth()"
      >
        <ng-container [ngTemplateOutlet]="sidebarContents" />
      </aside>
    }

    <ng-template #sidebarContents>
      <div class="cpk-sidebar-view-panel">
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
                  {{ resolvedTitle() }}
                </h2>
              }
            </div>
            <div class="cpk-modal-header-end">
              <button
                #initialFocus
                type="button"
                cdkFocusInitial
                class="cpk-modal-header-close-button"
                [attr.aria-label]="labels.modalHeaderCloseButtonLabel"
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
        <div class="cpk-sidebar-view-chat" data-sidebar-chat>
          <ng-container [ngComponentOutlet]="chatComponent()" />
        </div>
      </div>
    </ng-template>
  `,
  // The look comes from the shared CSS (cpk-* classes). These rules add what
  // the Angular sidebar does beyond React's: a backdrop in overlay mode and an
  // enter animation. As in React, the open sidebar covers the toggle.
  styles: `
    :host {
      display: contents;
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
    .copilot-sidebar-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1200;
    }
    .cpk-sidebar-view {
      z-index: 1201;
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
    @media (prefers-reduced-motion: no-preference) {
      .cpk-sidebar-view {
        animation: copilot-sidebar-enter 300ms cubic-bezier(0, 0, 0.2, 1);
      }
      .cpk-sidebar-view[data-position="left"] {
        animation-name: copilot-sidebar-enter-left;
      }
      @keyframes copilot-sidebar-enter {
        from {
          translate: 100% 0;
        }
      }
      @keyframes copilot-sidebar-enter-left {
        from {
          translate: -100% 0;
        }
      }
    }
  `,
})
export class CopilotSidebar {
  readonly open = model(true);
  readonly mode = input<CopilotSidebarMode>("docked");
  readonly position = input<CopilotSidebarPosition>("right");
  readonly width = input<number | string>(480);
  /** The header title. Default: `labels.modalHeaderTitle`. */
  readonly title = input<string | undefined>();
  readonly clickOutsideToClose = input(false);
  readonly chatComponent = input<Type<unknown>>(CopilotChat);
  readonly headerComponent = input<Type<unknown> | undefined>();

  protected readonly MessageCircleIcon = MessageCircle;
  protected readonly XIcon = X;
  protected readonly labels = injectChatLabels();
  protected readonly resolvedTitle = computed(
    () => this.title() ?? this.labels.modalHeaderTitle,
  );

  protected readonly sidebarId = `copilot-sidebar-${randomUUID()}`;
  protected readonly titleId = `${this.sidebarId}-title`;
  protected readonly resolvedWidth = computed(() =>
    dimensionToCss(this.width(), 480),
  );
  protected readonly isCompact = signal(false);
  protected readonly isModal = computed(
    () => this.mode() === "overlay" || this.isCompact(),
  );
  protected readonly dockAccepted = signal(true);

  private readonly owner = Symbol("copilot-sidebar");
  private readonly registry = inject(DockedSidebarRegistry);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly launcher =
    viewChild.required<ElementRef<HTMLButtonElement>>("launcher");
  private readonly initialFocus =
    viewChild<ElementRef<HTMLButtonElement>>("initialFocus");
  private ownsDock = false;

  constructor() {
    afterNextRender(() => {
      if (this.open() && this.isModal()) this.focusModal();
      const media = this.document.defaultView?.matchMedia?.(
        "(max-width: 47.999rem)",
      );
      if (!media) return;
      const update = () => this.isCompact.set(media.matches);
      update();
      media.addEventListener("change", update);
      this.destroyRef.onDestroy(() =>
        media.removeEventListener("change", update),
      );
    });

    // `position` and `resolvedWidth` are dependencies even though they are only
    // consumed on the docked path: a width or side change while docked must
    // re-push the registry entry. On the undocked path the extra re-run is
    // inert — `releaseDock()` is a no-op without ownership and `dockAccepted`
    // is set to the value it already holds.
    explicitEffect(
      () => ({
        shouldDock: this.isBrowser && this.open() && !this.isModal(),
        position: this.position(),
        width: this.resolvedWidth(),
      }),
      ({ shouldDock, position, width }) => {
        if (!shouldDock) {
          this.releaseDock();
          this.dockAccepted.set(true);
          return;
        }
        if (!this.ownsDock) {
          this.ownsDock = this.registry.acquire(this.owner);
          this.dockAccepted.set(this.ownsDock);
          if (!this.ownsDock) {
            console.warn(
              "[CopilotKit] Only one docked CopilotSidebar may be open per document.",
            );
            return;
          }
        }
        this.registry.update(this.owner, position, width);
      },
    );

    this.destroyRef.onDestroy(() => this.releaseDock());
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else {
      this.open.set(true);
      queueMicrotask(() => {
        if (this.isModal()) this.focusModal();
      });
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

  private releaseDock(): void {
    if (!this.ownsDock) return;
    this.registry.release(this.owner);
    this.ownsDock = false;
  }

  private focusModal(): void {
    this.initialFocus()?.nativeElement.focus({ preventScroll: true });
  }
}
