import { Component } from "@angular/core";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkit/angular";

/**
 * Chat with the scripted `a2ui-dashboard` agent (no API key needed). Its
 * dashboard renders with `dashboardCatalog`: the Angular basic catalog plus
 * the custom components in `./dashboard-components.ts`.
 */
@Component({
  selector: "a2ui-angular-demo",
  imports: [CopilotChat],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Say anything to load the dashboard…",
    }),
  ],
  template: `
    <div class="layout">
      <aside class="explainer">
        <h1>Angular A2UI</h1>
        <p>
          The agent streams A2UI operations; this app renders them with standalone
          Angular components. The catalog is the basic catalog plus five components
          registered in a few lines:
        </p>
        <pre><code>{{ snippet }}</code></pre>
        <p>
          <strong>Metric</strong> binds <code>value</code> to the data model,
          <strong>InfoRow</strong> takes one input per prop, and
          <strong>Card</strong> replaces the basic card. Buttons send A2UI actions
          back to the agent.
        </p>
      </aside>
      <copilot-chat class="chat" agentId="a2ui-dashboard" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 380px) 1fr;
      height: 100%;
    }
    .explainer {
      overflow: auto;
      padding: 24px;
      border-right: 1px solid #e5e7eb;
      font-size: 14px;
      line-height: 1.5;
    }
    h1 {
      margin-top: 0;
      font-size: 20px;
    }
    pre {
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      background: #f4f4f5;
      font-size: 12px;
    }
    .chat {
      display: block;
      min-width: 0;
      height: 100%;
    }
  `,
})
export class A2UIAngularDemoComponent {
  protected readonly snippet = `const definitions = {
  Metric: {
    props: z.object({
      label: z.string(),
      value: DynamicStringSchema,
    }),
  },
  // Card, StatusBadge, InfoRow, BarChart…
} satisfies A2UICatalogDefinitions;

export const dashboardCatalog = createAngularCatalog(
  definitions,
  { Metric: MetricComponent, /* … */ },
  { includeBasicCatalog: true },
);

provideCopilotKit({ a2ui: { catalog: dashboardCatalog } });`;
}
