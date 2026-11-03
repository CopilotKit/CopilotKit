import { isPlatformBrowser } from "@angular/common";
import type { AbstractAgent } from "@ag-ui/client";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import { ɵMcpAppHost } from "@copilotkit/mcp-apps-renderer/activity";
import { type MCPAppsSnapshotContent } from "./mcp-apps-content";
import { MCP_APPS_CONFIG } from "./mcp-apps-config";

/**
 * Angular draws the state; the shared `ɵMcpAppHost` owns the iframe, its size
 * and the MCP session (scoped to the widget, Angular's contract).
 */
@Component({
  selector: "copilot-mcp-apps-widget",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #appContainer class="copilot-mcp-apps-container">
      @if (isBrowser && state().loading) {
        <p class="copilot-mcp-apps-status" role="status" aria-live="polite">
          Loading MCP App…
        </p>
      }
      @if (state().error || state().contentError) {
        <p class="copilot-mcp-apps-error" role="alert">
          {{ state().error || state().contentError }}
        </p>
      }
    </div>
  `,
  styles: `
    .copilot-mcp-apps-container {
      position: relative;
      width: 100%;
      min-height: 100px;
      overflow: hidden;
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
  readonly data = input.required<MCPAppsSnapshotContent>();
  readonly agent = input<AbstractAgent | undefined>();
  /** Omitted for direct widget use with external, prop-driven content. */
  readonly messageId = input<string>();

  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly app = new ɵMcpAppHost({
    host: inject(CopilotKit).core,
    sessionOptions: inject(MCP_APPS_CONFIG),
    scopeToWidget: true,
    iframeAttributes: {
      "data-testid": "mcp-app-iframe",
      title: "Interactive MCP application",
    },
    importRenderer: () => import("@copilotkit/mcp-apps-renderer"),
  });
  protected readonly state = signal(this.app.getState());
  private readonly appContainer =
    viewChild.required<ElementRef<HTMLDivElement>>("appContainer");

  constructor() {
    const unsubscribe = this.app.subscribe(() =>
      this.state.set(this.app.getState()),
    );
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.app.destroy();
    });
    // Runs in the browser only, so nothing is created during SSR. Content
    // updates feed the existing session and never reload its iframe.
    afterRenderEffect(() => {
      this.app.setAgent(this.agent());
      this.app.setMessageId(this.messageId());
      this.app.setContent(this.data());
      this.app.setContainer(this.appContainer().nativeElement);
    });
  }
}
