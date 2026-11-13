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
import { type MCPAppsSnapshotContent } from "./mcp-apps-content";
import { MCP_APPS_CONFIG } from "./mcp-apps-config";

/** Angular owns the DOM and reactive state; the shared session owns MCP. */
@Component({
  selector: "copilot-mcp-apps-widget",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="copilot-mcp-apps-container">
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
    </div>
  `,
  styles: `
    .copilot-mcp-apps-container {
      position: relative;
      width: 100%;
      min-height: 100px;
      overflow: hidden;
    }

    .copilot-mcp-apps-frame {
      display: block;
      width: 100%;
      min-height: 100px;
      border: 0;
      background: transparent;
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
  protected readonly loading = signal(true);
  protected readonly error = signal("");
  protected readonly contentError = signal("");

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
                  frame.style.height = `${Math.ceil(Math.min(height, 5000))}px`;
                }
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
  }
}
