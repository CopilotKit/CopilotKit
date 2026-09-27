import {
  DOCUMENT,
  NgComponentOutlet,
  isPlatformBrowser,
} from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  Type,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from "@angular/core";
import { randomUUID } from "@copilotkit/shared";

import { CopilotChat } from "../chat/copilot-chat";
import { explicitEffect } from "../../explicit-effect";
import { CopilotThreadsDrawer } from "../chat/copilot-threads-drawer";
import { CopilotChatToggleButton } from "./copilot-chat-toggle-button";
import { CopilotModalHeader } from "./copilot-modal-header";
import { DockedSidebarRegistry } from "./docked-sidebar-registry";
import {
  chatComponentInputs,
  dimensionToCss,
  provideModalChatConfiguration,
  resolveModalThreadsDrawer,
  type CopilotModalThreadsDrawer,
} from "./modal-utils";

export type CopilotSidebarMode = "docked" | "overlay";
export type CopilotSidebarPosition = "left" | "right";

/**
 * Full-height chat panel matching React's `CopilotSidebar`. `docked` (the
 * default) pushes the page aside with a body margin on desktop; `overlay`
 * floats over the page. Below 768px it always overlays at full width. There
 * is no backdrop: an outside click closes it only with `clickOutsideToClose`.
 */
@Component({
  selector: "copilot-sidebar",
  imports: [
    NgComponentOutlet,
    CopilotChatToggleButton,
    CopilotModalHeader,
    CopilotThreadsDrawer,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideModalChatConfiguration()],
  host: {
    class: "copilot-sidebar-host",
    "data-copilotkit": "",
    "(document:keydown.escape)": "onEscape($event)",
    "(document:pointerdown)": "onDocumentPointerDown($event)",
  },
  template: `
    <button
      #launcher
      copilotChatToggleButton
      data-copilot-sidebar-toggle
      [open]="open()"
      [position]="position()"
      [attr.aria-controls]="sidebarId"
      [attr.tabindex]="open() ? -1 : null"
      (click)="toggle()"
    ></button>

    @if (open() && (isOverlay() || dockAccepted())) {
      <aside
        #panel
        tabindex="-1"
        role="complementary"
        class="copilotKitSidebar copilotKitWindow cpk:fixed cpk:top-0 cpk:z-[1200] cpk:flex cpk:h-[100dvh] cpk:max-h-screen cpk:w-full cpk:md:w-[min(var(--copilot-sidebar-width),100vw)] cpk:border-border cpk:bg-background cpk:text-foreground cpk:shadow-[0_0_48px_-16px_rgb(0_0_0/0.20)] cpk:focus:outline-none cpk:pt-[env(safe-area-inset-top)] cpk:pb-[env(safe-area-inset-bottom)] cpk:data-[position=right]:right-0 cpk:data-[position=right]:border-l cpk:data-[position=left]:left-0 cpk:data-[position=left]:border-r"
        [class.modal]="isOverlay()"
        [class.docked]="!isOverlay()"
        animate.enter="cpk-sidebar-enter"
        animate.leave="cpk-sidebar-leave"
        data-copilot-sidebar
        data-testid="copilot-sidebar"
        [attr.id]="sidebarId"
        [attr.data-position]="position()"
        [attr.aria-labelledby]="headerComponent() ? null : titleId"
        [attr.aria-label]="headerComponent() ? title() : null"
        [style.--copilot-sidebar-width]="resolvedWidth()"
      >
        <div
          class="cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden"
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
          <div class="cpk:min-h-0 cpk:flex-1 cpk:overflow-hidden" data-sidebar-chat>
            <ng-container
              [ngComponentOutlet]="chatComponent()"
              [ngComponentOutletInputs]="chatInputs()"
            />
          </div>
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
      </aside>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class CopilotSidebar {
  readonly open = model(true);
  readonly mode = input<CopilotSidebarMode>("docked");
  readonly position = input<CopilotSidebarPosition>("right");
  readonly width = input<number | string>(480);
  readonly title = input("CopilotKit Chat");
  readonly clickOutsideToClose = input(false);
  readonly chatComponent = input<Type<unknown>>(CopilotChat);
  readonly headerComponent = input<Type<unknown> | undefined>();
  /**
   * Opt-in threads drawer: a launcher at the start of the header opens the
   * thread list as a panel over the sidebar. `true` for the default drawer, an
   * object to configure it. Its open state is local to this sidebar.
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

  protected readonly sidebarId = `copilot-sidebar-${randomUUID()}`;
  protected readonly titleId = `${this.sidebarId}-title`;
  protected readonly resolvedWidth = computed(() =>
    dimensionToCss(this.width(), 480),
  );
  protected readonly isCompact = signal(false);
  /** Floats over the page instead of docking (overlay mode, or a narrow viewport). */
  protected readonly isOverlay = computed(
    () => this.mode() === "overlay" || this.isCompact(),
  );
  protected readonly dockAccepted = signal(true);

  private readonly owner = Symbol("copilot-sidebar");
  private readonly registry = inject(DockedSidebarRegistry);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly launcher = viewChild.required("launcher", {
    read: ElementRef<HTMLButtonElement>,
  });
  private readonly panel = viewChild<ElementRef<HTMLElement>>("panel");
  private ownsDock = false;

  constructor() {
    afterNextRender(() => {
      if (this.open() && this.isOverlay()) this.focusPanel();
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
        shouldDock: this.isBrowser && this.open() && !this.isOverlay(),
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

    // Closing the sidebar closes its drawer, so it never reopens expanded.
    explicitEffect(this.open, (open) => {
      if (!open) this.drawerOpen.set(false);
    });
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else {
      this.open.set(true);
      queueMicrotask(() => this.focusPanel());
    }
  }

  /**
   * Escape closes an open threads drawer first; otherwise, with focus inside,
   * it closes an overlay sidebar. A docked sidebar stays put, like React's.
   */
  protected onEscape(event: Event): void {
    if (!this.open() || event.defaultPrevented) return;
    if (this.drawerOpen()) {
      event.preventDefault();
      this.drawerOpen.set(false);
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (this.isOverlay() && panel?.contains(this.document.activeElement)) {
      event.preventDefault();
      this.close();
    }
  }

  protected onDocumentPointerDown(event: Event): void {
    if (!this.open() || !this.clickOutsideToClose()) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (this.panel()?.nativeElement.contains(target)) return;
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

  private releaseDock(): void {
    if (!this.ownsDock) return;
    this.registry.release(this.owner);
    this.ownsDock = false;
  }

  /** Focus the panel itself unless something inside it already has focus. */
  private focusPanel(): void {
    const panel = this.panel()?.nativeElement;
    if (panel && !panel.contains(this.document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
  }
}
