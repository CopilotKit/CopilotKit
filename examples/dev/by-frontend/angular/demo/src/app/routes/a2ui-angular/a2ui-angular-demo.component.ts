import { Component } from "@angular/core";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkit/angular";

/**
 * Chat with the scripted `a2ui-dashboard` agent (no API key needed). The
 * agent writes A2UI v0.9; the runtime converts its surface to A2UI 1.0, and
 * `dashboardUI` renders it: the standard catalog plus the custom components
 * in `./dashboard-components.ts`.
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
          The agent streams A2UI v0.9 operations. The runtime converts them to A2UI
          1.0, and this app renders them with generative UI and standalone Angular
          components: the standard catalog plus five components registered in a few
          lines.
        </p>
        <pre><code>{{ snippet }}</code></pre>
        <p>
          <strong>Metric</strong> binds <code>value</code> to the data model, each
          component takes one input per prop, and
          <strong>DashboardCard</strong> renders its <code>child</code> slot.
          Buttons send their events back to the agent in v0.9 form.
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
  protected readonly snippet = `export const dashboardUI = createGenerativeUI({
  id: "copilotkit/demo-dashboard@1",
  extends: [shopUI], // standardUI + the shop components
  components: {
    Metric: {
      component: MetricComponent,
      description: "A KPI tile with an optional trend.",
      props: z.object({ label: z.string(), value: z.string() }),
    },
    // DashboardCard, StatusBadge, InfoRow, BarChart…
  },
});

provideGenerativeUI({ ui: dashboardUI });

// Runtime: the agent speaks A2UI v0.9.
new CopilotRuntime({
  agents,
  generativeUI: { a2uiVersion: { "a2ui-dashboard": "0.9" } },
});`;
}
