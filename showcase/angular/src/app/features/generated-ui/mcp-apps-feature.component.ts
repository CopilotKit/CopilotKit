import { ChangeDetectionStrategy, Component } from "@angular/core";
import { registerRenderActivityMessage } from "@copilotkit/angular";
import { mcpAppsActivityRendererConfig } from "@copilotkit/angular/mcp-apps";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";

@Component({
  selector: "showcase-mcp-apps-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="generated-ui-feature-page">
      <section class="chat-surface" aria-label="Angular MCP Apps demonstration">
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class MCPAppsFeatureComponent {
  protected readonly demoLabel = "MCP Apps demonstration";

  constructor() {
    registerRenderActivityMessage(mcpAppsActivityRendererConfig);
  }
}
