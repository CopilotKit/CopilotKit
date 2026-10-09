import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotSidebar } from "@copilotkit/angular";
import { MCPAppsChatComponent } from "./mcp-apps-chat.component";

/**
 * MCP Apps demo, mirroring `examples/v2/react/demo/src/app/mcp-apps/page.tsx`:
 * same tool list, same sidebar layout, same runtime scope - only the framework
 * differs, so the two demos exercise the shared MCP Apps host identically.
 *
 * Two wiring differences from React, both forced by Angular's DI:
 *
 * - `provideMCPApps()` is registered at the ROOT (`app.config.ts`), not on this
 *   route. It stays an opt-in secondary entry point of the package, but the
 *   activity renderer is resolved from the root injector, so a lazy-route
 *   provider is silently never seen.
 * - React re-points the runtime URL with a nested provider; `provideCopilotKit`
 *   also resolves from the root injector, so this page selects the MCP-enabled
 *   agent by name instead (`[agentId]="'mcp-apps'"`, registered in
 *   `examples/v2/angular/demo-server`).
 */
@Component({
  selector: "mcp-apps-demo",
  standalone: true,
  imports: [CopilotSidebar],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="mcp-apps-page">
      <main class="mcp-apps-main">
        <section class="mcp-apps-intro">
          <h1>MCP Apps Demo</h1>
          <p>
            This page demonstrates the MCP Apps Extension. The assistant has access
            to MCP tools that can render interactive UI components directly in the
            chat.
          </p>
          <div class="mcp-apps-tools">
            <p class="mcp-apps-tools-title">Available MCP Tools (ext-apps):</p>
            <ul>
              @for (tool of tools; track tool.name) {
                <li>
                  <code>{{ tool.name }}</code> - {{ tool.description }}
                </li>
              }
            </ul>
            <div class="mcp-apps-hint">
              <p>To run the MCP servers:</p>
              <pre>{{ mcpServerSetup }}</pre>
            </div>
          </div>
        </section>

        <section class="mcp-apps-cards">
          @for (card of cards; track card) {
            <article>
              <h2>Demo Card {{ card }}</h2>
              <p>
                Try asking the assistant to use MCP tools. The UI will render
                directly in the chat sidebar.
              </p>
            </article>
          }
        </section>
      </main>

      <copilot-sidebar width="50%" [chatComponent]="chatComponent" />
    </div>
  `,
  styles: [
    `
      .mcp-apps-page {
        position: relative;
        min-height: 100vh;
        background: linear-gradient(135deg, #f1f5f9, #ffffff 50%, #e2e8f0);
      }
      .mcp-apps-main {
        margin: 0 auto;
        display: flex;
        width: 100%;
        max-width: 64rem;
        flex-direction: column;
        gap: 2rem;
        padding: 3rem 1.5rem;
      }
      .mcp-apps-intro h1 {
        font-size: 1.875rem;
        font-weight: 600;
        color: #0f172a;
        margin: 0 0 0.5rem;
      }
      .mcp-apps-intro p {
        max-width: 42rem;
        color: #475569;
      }
      .mcp-apps-tools {
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        background: #fff;
        padding: 1rem;
        font-size: 0.875rem;
        color: #475569;
      }
      .mcp-apps-tools-title {
        font-weight: 500;
        color: #0f172a;
      }
      .mcp-apps-tools ul {
        margin: 0.5rem 0 0;
        padding-left: 1.25rem;
      }
      .mcp-apps-tools code,
      .mcp-apps-hint pre {
        background: #f1f5f9;
        border-radius: 0.25rem;
        padding: 0.125rem 0.25rem;
      }
      .mcp-apps-hint {
        margin-top: 0.75rem;
        font-size: 0.75rem;
        color: #64748b;
      }
      .mcp-apps-hint pre {
        padding: 0.5rem;
        overflow-x: auto;
      }
      .mcp-apps-cards {
        display: grid;
        gap: 1.5rem;
      }
      @media (min-width: 768px) {
        .mcp-apps-cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .mcp-apps-cards article {
        border: 1px solid #e2e8f0;
        border-radius: 1rem;
        background: #fff;
        padding: 1.5rem;
        box-shadow: 0 1px 2px rgb(15 23 42 / 0.05);
      }
      .mcp-apps-cards h2 {
        font-size: 1.125rem;
        font-weight: 500;
        color: #0f172a;
        margin: 0;
      }
      .mcp-apps-cards p {
        margin: 0.5rem 0 0;
        font-size: 0.875rem;
        color: #475569;
      }
    `,
  ],
})
export class MCPAppsComponent {
  /** Rendered inside the sidebar; carries the MCP agent + thread. */
  readonly chatComponent = MCPAppsChatComponent;

  /** Same list as the React demo page. */
  readonly tools = [
    { name: "get-time", description: "Current server time" },
    { name: "get-budget-data", description: "Interactive budget allocation" },
    { name: "get-cohort-data", description: "Cohort analysis heatmap" },
    {
      name: "get-customer-data",
      description: "Customer segmentation analysis",
    },
    {
      name: "get-scenario-data",
      description: "SaaS financial scenario modeling",
    },
    { name: "play-sheet-music", description: "Music notation rendering" },
    { name: "get-system-stats", description: "System monitoring dashboard" },
    { name: "show_threejs_scene", description: "3D visualization (Three.js)" },
    { name: "play_video", description: "Video player" },
    { name: "get-first-degree-links", description: "Wikipedia link explorer" },
  ];

  readonly cards = [1, 2, 3, 4];

  readonly mcpServerSetup = `git clone https://github.com/modelcontextprotocol/ext-apps
cd ext-apps
npm install
npm start`;
}
