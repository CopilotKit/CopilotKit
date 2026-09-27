import { NgComponentOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Type,
  afterNextRender,
  computed,
  effect,
  input,
  model,
  signal,
  viewChild,
} from "@angular/core";
import { randomUUID } from "@copilotkit/shared";

import { CopilotChat } from "../chat/copilot-chat";
import { CopilotThreadsDrawer } from "../chat/copilot-threads-drawer";
import { CopilotChatToggleButton } from "./copilot-chat-toggle-button";
import { CopilotModalHeader } from "./copilot-modal-header";
import {
  chatComponentInputs,
  dimensionToCss,
  provideModalChatConfiguration,
  resolveModalThreadsDrawer,
  type CopilotModalThreadsDrawer,
} from "./modal-utils";

export type { CopilotModalThreadsDrawer } from "./modal-utils";

/**
 * Floating chat window anchored to a round launcher, matching React's
 * `CopilotPopup`: no backdrop, Escape closes it (after an open threads drawer),
 * and an outside click closes it only with `clickOutsideToClose`.
 */
@Component({
  selector: "copilot-popup",
  imports: [
    NgComponentOutlet,
    CopilotChatToggleButton,
    CopilotModalHeader,
    CopilotThreadsDrawer,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideModalChatConfiguration()],
  host: {
    class: "copilot-popup-host",
    "data-copilotkit": "",
    "(document:keydown.escape)": "onEscape($event)",
    "(document:pointerdown)": "onDocumentPointerDown($event)",
  },
  template: `
    <button
      #launcher
      copilotChatToggleButton
      data-copilot-popup-toggle
      [open]="open()"
      [attr.aria-controls]="dialogId"
      (click)="toggle()"
    ></button>

    @if (open()) {
      <div
        class="cpk:fixed cpk:inset-0 cpk:z-[1200] cpk:flex cpk:max-w-full cpk:flex-col cpk:items-stretch cpk:md:inset-auto cpk:md:bottom-24 cpk:md:right-6 cpk:md:items-end"
      >
        <section
          #dialog
          tabindex="-1"
          role="dialog"
          class="copilotKitPopup copilotKitWindow cpk:relative cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden cpk:bg-background cpk:text-foreground cpk:origin-bottom cpk:focus:outline-none cpk:border cpk:border-transparent cpk:md:h-[var(--copilot-popup-height)] cpk:md:w-[var(--copilot-popup-width)] cpk:md:max-h-[calc(100dvh-7.5rem)] cpk:md:max-w-[calc(100vw-3rem)] cpk:md:origin-bottom-right cpk:md:rounded-2xl cpk:md:border-border cpk:md:shadow-[0_2px_6px_-1px_rgb(0_0_0/0.06),0_24px_64px_-12px_rgb(0_0_0/0.22)]"
          animate.enter="cpk-popup-enter"
          animate.leave="cpk-popup-leave"
          data-copilot-popup
          data-testid="copilot-popup"
          [attr.id]="dialogId"
          [attr.aria-labelledby]="headerComponent() ? null : titleId"
          [attr.aria-label]="headerComponent() ? title() : null"
          [style.--copilot-popup-width]="resolvedWidth()"
          [style.--copilot-popup-height]="resolvedHeight()"
        >
          <header
            copilotModalHeader
            [title]="title()"
            [titleId]="titleId"
            [headerComponent]="headerComponent()"
            [showDrawerLauncher]="!!drawer()"
            [drawerOpen]="drawerOpen()"
            (closeClick)="close()"
            (drawerToggle)="drawerOpen.set(!drawerOpen())"
          ></header>
          <div class="cpk:min-h-0 cpk:flex-1 cpk:overflow-hidden" data-popup-chat>
            <ng-container
              [ngComponentOutlet]="chatComponent()"
              [ngComponentOutletInputs]="chatInputs()"
            />
          </div>
          @if (drawer(); as drawerConfig) {
            <copilot-threads-drawer
              [overlay]="true"
              [(open)]="drawerOpen"
              [agentId]="drawerConfig.agentId"
              [label]="drawerConfig.label"
              [recentLabel]="drawerConfig.recentLabel"
              [limit]="drawerConfig.limit"
              [licenseUrl]="drawerConfig.licenseUrl"
            />
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class CopilotPopup {
  readonly open = model(true);
  readonly title = input("CopilotKit Chat");
  readonly width = input<number | string>(420);
  readonly height = input<number | string>(560);
  readonly clickOutsideToClose = input(false);
  readonly chatComponent = input<Type<unknown>>(CopilotChat);
  readonly headerComponent = input<Type<unknown> | undefined>();
  /**
   * Opt-in threads drawer: a launcher at the start of the header opens the
   * thread list as a panel over the popup. `true` for the default drawer, an
   * object to configure it. Its open state is local to this popup.
   */
  readonly threadsDrawer = input<CopilotModalThreadsDrawer>(false);
  /**
   * Ease the welcome screen in (greeting, suggestion cards, input). Defaults
   * to `true`; it plays each time the chat opens.
   */
  readonly introAnimation = input(true);

  protected readonly drawer = computed(() =>
    resolveModalThreadsDrawer(this.threadsDrawer()),
  );
  protected readonly drawerOpen = signal(false);
  protected readonly chatInputs = computed(() =>
    chatComponentInputs(this.chatComponent(), {
      introAnimation: this.introAnimation(),
    }),
  );

  protected readonly dialogId = `copilot-popup-${randomUUID()}`;
  protected readonly titleId = `${this.dialogId}-title`;
  protected readonly resolvedWidth = computed(() =>
    dimensionToCss(this.width(), 420),
  );
  protected readonly resolvedHeight = computed(() =>
    dimensionToCss(this.height(), 560),
  );
  private readonly launcher = viewChild.required("launcher", {
    read: ElementRef<HTMLButtonElement>,
  });
  private readonly dialog = viewChild<ElementRef<HTMLElement>>("dialog");

  constructor() {
    afterNextRender(() => {
      if (this.open()) this.focusDialog();
    });
    // Closing the popup closes its drawer, so it never reopens expanded.
    effect(() => {
      if (!this.open()) this.drawerOpen.set(false);
    });
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else {
      this.open.set(true);
      queueMicrotask(() => this.focusDialog());
    }
  }

  /** Escape closes an open threads drawer first, then the popup. */
  protected onEscape(event: Event): void {
    if (!this.open() || event.defaultPrevented) return;
    event.preventDefault();
    if (this.drawerOpen()) this.drawerOpen.set(false);
    else this.close();
  }

  protected onDocumentPointerDown(event: Event): void {
    if (!this.open() || !this.clickOutsideToClose()) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (this.dialog()?.nativeElement.contains(target)) return;
    if (this.launcher().nativeElement.contains(target)) return;
    this.close();
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    queueMicrotask(() =>
      this.launcher().nativeElement.focus({ preventScroll: true }),
    );
  }

  /** Focus the window itself unless something inside it already has focus. */
  private focusDialog(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }
  }
}
