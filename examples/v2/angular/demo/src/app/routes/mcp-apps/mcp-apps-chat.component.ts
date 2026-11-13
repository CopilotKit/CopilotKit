import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

/**
 * The chat rendered inside `<copilot-sidebar>` on the MCP Apps demo.
 *
 * `CopilotSidebar` takes a `chatComponent`, which is how this framework lets a
 * page keep the sidebar's own behaviour (open/close, mobile layout) while
 * choosing which agent the conversation runs against - here the MCP-enabled
 * agent registered by `examples/v2/angular/demo-server`.
 */
@Component({
  selector: "mcp-apps-chat",
  standalone: true,
  imports: [CopilotChat],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <copilot-chat [agentId]="'mcp-apps'" [threadId]="'mcp-apps-003'" />
  `,
})
export class MCPAppsChatComponent {}
