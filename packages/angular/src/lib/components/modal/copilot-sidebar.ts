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
import { bindModalDialog } from "./modal-dialog";
import {
  ɵSIDEBAR_DEFAULT_WIDTH,
  ɵSIDEBAR_TRANSITION_MS,
  ɵcreateDockedSidebar,
  ɵdimensionToCss,
  ɵwatchMobileViewport,
} from "@copilotkit/core";
import type { ɵDockedSidebar } from "@copilotkit/core";

export type CopilotSidebarMode = "docked" | "overlay";
export type CopilotSidebarPosition = "left" | "right";

/** Responsive chat sidebar with independent overlay and single-owner docked modes. */
@Component({
  selector: "copilot-sidebar",
  imports: [NgComponentOutlet, NgTemplateOutlet, CopilotIcon, CopilotKitStyles],
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
      data-slot="chat-toggle-button"
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
      <section
        #dialog
        tabindex="-1"
        data-copilotkit
        class="copilotKitSidebar copilotKitWindow cpk-sidebar-view modal"
        data-copilot-sidebar
        role="dialog"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? resolvedTitle() : null"
        [style.--sidebar-width]="resolvedWidth()"
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
  // the Angular sidebar does beyond React's: an enter animation. As in React,
  // the open sidebar covers the toggle.
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
  readonly width = input<number | string>(ɵSIDEBAR_DEFAULT_WIDTH);
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
    ɵdimensionToCss(this.width(), ɵSIDEBAR_DEFAULT_WIDTH),
  );
  protected readonly isCompact = signal(false);
  protected readonly isModal = computed(
    () => this.mode() === "overlay" || this.isCompact(),
  );
  protected readonly dockAccepted = signal(true);

  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly launcher =
    viewChild.required<ElementRef<HTMLButtonElement>>("launcher");
  private readonly initialFocus =
    viewChild<ElementRef<HTMLButtonElement>>("initialFocus");
  private readonly dialog = viewChild<ElementRef<HTMLElement>>("dialog");
  /** Core's page-margin owner for the docked mode, as in React and Vue. */
  private readonly dock: ɵDockedSidebar | undefined = this.isBrowser
    ? ɵcreateDockedSidebar(this.document, {
        transitionMs: ɵSIDEBAR_TRANSITION_MS,
      })
    : undefined;

  constructor() {
    afterNextRender(() => {
      const stop = ɵwatchMobileViewport((isMobile) =>
        this.isCompact.set(isMobile),
      );
      this.destroyRef.onDestroy(stop);
    });

    // `position` and `resolvedWidth` are dependencies even though they are only
    // consumed on the docked path: a width or side change while docked must
    // move the page margin.
    explicitEffect(
      () => ({
        open: this.open() && !this.isModal(),
        position: this.position(),
        width: this.resolvedWidth(),
      }),
      (state) => {
        if (!this.dock) return;
        this.dock.set(state);
        // Core warns when another docked sidebar has the margin.
        this.dockAccepted.set(!state.open || this.dock.isDocked);
      },
    );

    // In overlay mode (and on mobile): core's dialog focus and dismissal.
    bindModalDialog({
      dialog: this.dialog,
      initialFocus: this.initialFocus,
      launcher: this.launcher,
      clickOutsideToClose: this.clickOutsideToClose,
      close: () => this.close(),
    });

    this.destroyRef.onDestroy(() => this.dock?.dispose());
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.open.set(true);
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    queueMicrotask(() =>
      this.launcher().nativeElement.focus({ preventScroll: true }),
    );
  }
}
