import { isPlatformBrowser } from "@angular/common";
import type { AbstractAgent } from "@ag-ui/client";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import type { McpAppSession } from "@copilotkit/mcp-apps-renderer";
import {
  ɵlockBodyScroll,
  ɵshowDialogForMode,
} from "@copilotkit/mcp-apps-renderer/activity";
import type { McpAppsDisplayMode } from "@copilotkit/mcp-apps-renderer/activity";
import { type MCPAppsSnapshotContent } from "./mcp-apps-content";
import { MCP_APPS_CONFIG } from "./mcp-apps-config";

/**
 * Angular owns the DOM and reactive state; the shared session owns MCP.
 *
 * The widget surface is a native `<dialog>`: inline opens it in normal flow,
 * fullscreen opens it in the browser top layer, which fills the viewport
 * whatever containing block an ancestor establishes. The iframe stays inside
 * the dialog across transitions, so switching modes never reloads the widget.
 */
@Component({
  selector: "copilot-mcp-apps-widget",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #surface
      class="copilot-mcp-apps-container"
      [class.copilot-mcp-apps-container--fullscreen]="fullscreen()"
      [attr.aria-label]="fullscreen() ? 'Fullscreen widget' : null"
      (cancel)="onCancel($event)"
    >
      @if (fullscreen()) {
        <button
          #exitButton
          type="button"
          class="copilot-mcp-apps-exit-fullscreen"
          aria-label="Exit fullscreen"
          (click)="exitFullscreen()"
        >
          ×
        </button>
      }
      @if (loading()) {
        <p class="copilot-mcp-apps-status" role="status" aria-live="polite">
          Loading MCP App…
        </p>
      }
      @if (error() || contentError()) {
        <p class="copilot-mcp-apps-error" role="alert">
          {{ error() || contentError() }}
        </p>
      }
      <iframe
        #appFrame
        class="copilot-mcp-apps-frame"
        data-testid="mcp-app-iframe"
        title="Interactive MCP application"
      ></iframe>
    </dialog>
  `,
  styles: `
    /* Inline: neutralize the UA dialog styles so it renders as an in-flow block. */
    .copilot-mcp-apps-container {
      position: static;
      width: 100%;
      max-width: none;
      max-height: none;
      min-height: 100px;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      background: transparent;
      color: inherit;
    }

    /* Fullscreen: fill the viewport from the top layer. */
    .copilot-mcp-apps-container--fullscreen {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      overflow: auto;
      z-index: 2147483000;
      /* The chat's own background token, so the overlay does not flash white
         in dark mode. */
      background: var(--background, #fff);
    }

    .copilot-mcp-apps-exit-fullscreen {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }

    .copilot-mcp-apps-frame {
      display: block;
      width: 100%;
      min-height: 100px;
      border: 0;
      background: transparent;
    }

    .copilot-mcp-apps-container--fullscreen .copilot-mcp-apps-frame {
      height: 100%;
      min-height: 0;
    }

    .copilot-mcp-apps-status,
    .copilot-mcp-apps-error {
      margin: 0;
      padding: 16px;
    }

    .copilot-mcp-apps-status {
      color: #525252;
    }

    .copilot-mcp-apps-error {
      color: #991b1b;
    }
  `,
})
export class CopilotMCPAppsWidget {
  private readonly config = inject(MCP_APPS_CONFIG);
  private readonly copilotKit = inject(CopilotKit);
  private readonly platformId = inject(PLATFORM_ID);
  private session: McpAppSession | undefined;
  /** The height the widget last reported, restored when leaving fullscreen. */
  private reportedHeight: string | undefined;

  readonly data = input.required<MCPAppsSnapshotContent>();
  readonly agent = input<AbstractAgent | undefined>();
  /** Omitted for direct widget use with external, prop-driven content. */
  readonly messageId = input<string>();

  private readonly identity = computed(
    () => {
      const { resourceUri, serverHash, serverId } = this.data();
      return { resourceUri, serverHash, serverId };
    },
    {
      equal: (a, b) =>
        a.resourceUri === b.resourceUri &&
        a.serverHash === b.serverHash &&
        a.serverId === b.serverId,
    },
  );

  private readonly appFrame =
    viewChild.required<ElementRef<HTMLIFrameElement>>("appFrame");
  private readonly surface =
    viewChild.required<ElementRef<HTMLDialogElement>>("surface");
  private readonly exitButton =
    viewChild<ElementRef<HTMLButtonElement>>("exitButton");
  protected readonly loading = signal(true);
  protected readonly error = signal("");
  protected readonly contentError = signal("");
  // The display mode the session granted. The session owns the negotiation
  // (grant/refuse + host-context notification); this component only renders
  // the surface for the mode, fed by the onDisplayModeChange hook below.
  protected readonly displayMode = signal<McpAppsDisplayMode>("inline");
  protected readonly fullscreen = computed(
    () => this.displayMode() === "fullscreen",
  );

  constructor() {
    afterRenderEffect((onCleanup) => {
      this.identity();
      const agent = this.agent();
      const messageId = this.messageId();
      const frame = this.appFrame().nativeElement;
      let active = true;
      let session: McpAppSession | undefined;
      this.loading.set(true);
      this.error.set("");
      this.contentError.set("");
      this.displayMode.set("inline");
      this.reportedHeight = undefined;
      frame.style.removeProperty("height");
      frame.removeAttribute("src");
      frame.removeAttribute("srcdoc");
      frame.removeAttribute("data-mcp-app-initialized");
      onCleanup(() => {
        active = false;
        session?.teardown();
        if (this.session === session) this.session = undefined;
        frame.removeAttribute("srcdoc");
        frame.removeAttribute("src");
        frame.removeAttribute("data-mcp-app-initialized");
      });
      if (!isPlatformBrowser(this.platformId)) {
        this.loading.set(false);
        return;
      }
      if (!agent) {
        this.loading.set(false);
        this.error.set("No agent is available to load this MCP App.");
        return;
      }
      const fail = (error: Error) => {
        if (!active) return;
        this.loading.set(false);
        this.error.set(error.message);
        session?.teardown();
        frame.removeAttribute("srcdoc");
        frame.removeAttribute("data-mcp-app-initialized");
      };
      // Cleanup is registered before importing, so an obsolete bind never starts.
      void import("@copilotkit/mcp-apps-renderer")
        .catch((importErr: unknown) => {
          // Name the packages and the fix: the raw module-resolution error
          // ("Failed to fetch dynamically imported module...") tells a user
          // nothing about what to install. Same message as React and Vue.
          throw new Error(
            "MCP Apps require '@copilotkit/mcp-apps-renderer' and its " +
              "'@modelcontextprotocol/ext-apps' dependency. Reinstall your " +
              "dependencies if this package is missing.",
            { cause: importErr },
          );
        })
        .then((mcp) => {
          if (!active) return;
          session = mcp.bindMcpApp({
            iframe: frame,
            getContent: () => untracked(this.data),
            getAgent: () => agent,
            messageId,
            host: this.copilotKit.core,
            options: this.config,
            cancelFollowUpsOnTeardown: true,
            requireExactResourceUri: true,
            cancelRunningWaitOnTeardown: true,
            hooks: {
              onSandboxReady: () => {
                if (active) this.loading.set(false);
              },
              onInitialized: () => {
                if (!active) return;
                this.loading.set(false);
                frame.setAttribute("data-mcp-app-initialized", "true");
              },
              onSizeChanged: ({ height }) => {
                if (
                  active &&
                  typeof height === "number" &&
                  Number.isFinite(height) &&
                  height > 0
                ) {
                  // A size reported while fullscreen describes the fullscreen
                  // layout: the frame fills the surface there, and the inline
                  // height restored on exit is the last one reported inline.
                  if (!untracked(this.fullscreen)) {
                    this.reportedHeight = `${Math.ceil(Math.min(height, 5000))}px`;
                    frame.style.height = this.reportedHeight;
                  }
                }
              },
              onDisplayModeChange: (mode) => {
                if (active) this.displayMode.set(mode);
              },
              onError: fail,
              onContentError: (err) => {
                if (active) this.contentError.set(err?.message ?? "");
              },
              onFollowUpError: fail,
            },
          });
          this.session = session;
          session.syncContent(untracked(this.data));
        })
        .catch(fail);
    });
    // Content updates feed the existing session and never reload its iframe.
    afterRenderEffect(() => {
      const data = this.data();
      untracked(() => this.session?.syncContent(data));
    });
    // Open the <dialog> surface for the granted mode. While fullscreen, the
    // page scroll is locked behind the widget (shared with the other widgets
    // on the page) and the advertised surface follows viewport resizes; focus
    // and Escape come from the modal dialog itself.
    afterRenderEffect((onCleanup) => {
      const mode = this.displayMode();
      if (!isPlatformBrowser(this.platformId)) return;
      const dialog = this.surface().nativeElement;
      const frame = this.appFrame().nativeElement;
      ɵshowDialogForMode(dialog, mode);
      if (mode !== "fullscreen") {
        if (this.reportedHeight) frame.style.height = this.reportedHeight;
        else frame.style.removeProperty("height");
        return;
      }
      frame.style.height = "100%";
      // Escape reaches the modal dialog only while focus is on the host side;
      // inside the sandboxed widget the key never leaves the iframe. Landing
      // focus on the exit button makes Escape work from the moment of entry.
      this.exitButton()?.nativeElement.focus();
      const onResize = () => this.session?.setDisplayMode("fullscreen");
      window.addEventListener("resize", onResize);
      const releaseScrollLock = ɵlockBodyScroll();
      onCleanup(() => {
        window.removeEventListener("resize", onResize);
        releaseScrollLock();
      });
    });
  }

  /**
   * Host-initiated exit from fullscreen (close button or Escape). Routed
   * through the session so the host context is updated and the widget is
   * notified, exactly like a widget-initiated change.
   */
  protected exitFullscreen(): void {
    this.session?.setDisplayMode("inline");
  }

  /** Escape on the modal dialog fires `cancel`; keep the dialog open and exit through the host. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.exitFullscreen();
  }
}
