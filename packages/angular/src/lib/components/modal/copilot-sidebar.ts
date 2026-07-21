import { CdkTrapFocus } from "@angular/cdk/a11y";
import { DOCUMENT, NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  Type,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { randomUUID } from "@copilotkit/shared";

import { CopilotChat } from "../chat/copilot-chat";
import { DockedSidebarRegistry } from "./docked-sidebar-registry";
import { dimensionToCss } from "./modal-utils";

export type CopilotSidebarMode = "docked" | "overlay";
export type CopilotSidebarPosition = "left" | "right";

/** Responsive chat sidebar with independent overlay and single-owner docked modes. */
@Component({
  selector: "copilot-sidebar",
  imports: [CdkTrapFocus, NgComponentOutlet, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "copilot-sidebar-host", "data-copilotkit": "" },
  template: `
    <button
      #launcher
      type="button"
      class="copilot-sidebar-toggle"
      data-copilot-sidebar-toggle
      [class.position-left]="position() === 'left'"
      [attr.aria-controls]="sidebarId"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="open() ? 'Close Copilot sidebar' : 'Open Copilot sidebar'"
      [tabIndex]="open() ? -1 : 0"
      (click)="toggle()"
    >
      <span aria-hidden="true">{{ open() ? "×" : "✦" }}</span>
    </button>

    @if (open() && isModal()) {
      <div
        class="copilot-sidebar-backdrop"
        data-copilot-sidebar-backdrop
        aria-hidden="true"
        (click)="closeFromBackdrop()"
      ></div>
      <aside
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="copilot-sidebar-window copilotKitSidebar modal"
        data-copilot-sidebar
        role="dialog"
        aria-modal="true"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? title() : null"
        [style.--copilot-sidebar-width]="resolvedWidth()"
        (keydown.escape)="close()"
      >
        <ng-container [ngTemplateOutlet]="sidebarContents" />
      </aside>
    } @else if (open() && dockAccepted()) {
      <aside
        class="copilot-sidebar-window copilotKitSidebar docked"
        data-copilot-sidebar
        role="complementary"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="titleId"
        [style.--copilot-sidebar-width]="resolvedWidth()"
      >
        <ng-container [ngTemplateOutlet]="sidebarContents" />
      </aside>
    }

    <ng-template #sidebarContents>
      <header class="copilot-sidebar-header">
        @if (headerComponent(); as header) {
          <ng-container [ngComponentOutlet]="header" />
        } @else {
          <h2 [attr.id]="titleId">{{ title() }}</h2>
        }
        <button
          #initialFocus
          type="button"
          cdkFocusInitial
          aria-label="Close Copilot sidebar"
          (click)="close()"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="copilot-sidebar-chat">
        <ng-container [ngComponentOutlet]="chatComponent()" />
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: contents;
    }
    .copilot-sidebar-toggle {
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
    .copilot-sidebar-toggle.position-left {
      right: auto;
      left: max(1.5rem, env(safe-area-inset-left));
    }
    .copilot-sidebar-toggle:focus-visible,
    .copilot-sidebar-header button:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 3px;
    }
    .copilot-sidebar-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1200;
      background: rgb(15 23 42 / 24%);
    }
    .copilot-sidebar-window {
      position: fixed;
      top: 0;
      bottom: 0;
      z-index: 1201;
      display: grid;
      width: min(var(--copilot-sidebar-width), 100vw);
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      color: #111827;
      background: white;
      box-shadow: 0 0 42px rgb(15 23 42 / 20%);
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .copilot-sidebar-window[data-position="left"] {
      left: 0;
      border-right: 1px solid #dbe3eb;
    }
    .copilot-sidebar-window[data-position="right"] {
      right: 0;
      border-left: 1px solid #dbe3eb;
    }
    .copilot-sidebar-header {
      display: flex;
      min-height: 3.5rem;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .copilot-sidebar-header h2 {
      margin: 0;
      font-size: 1rem;
    }
    .copilot-sidebar-header button {
      border: 0;
      color: inherit;
      background: transparent;
      font-size: 1.5rem;
      cursor: pointer;
    }
    .copilot-sidebar-chat {
      min-height: 0;
      overflow: hidden;
    }
    @media (max-width: 47.999rem) {
      .copilot-sidebar-window {
        width: 100%;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .copilot-sidebar-window {
        animation: copilot-sidebar-enter 220ms ease-out;
      }
      @keyframes copilot-sidebar-enter {
        from {
          opacity: 0;
          transform: translateX(8%);
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
  readonly title = input("Copilot");
  readonly clickOutsideToClose = input(false);
  readonly chatComponent = input<Type<unknown>>(CopilotChat);
  readonly headerComponent = input<Type<unknown> | undefined>();

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

    effect(() => {
      const shouldDock = this.isBrowser && this.open() && !this.isModal();
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
      this.registry.update(this.owner, this.position(), this.resolvedWidth());
    });

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
