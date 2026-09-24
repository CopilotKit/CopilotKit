import { JsonPipe } from "@angular/common";
import { Component, signal } from "@angular/core";
import { CopilotA2UISurface } from "@copilotkit/angular/a2ui";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer/web-components";
import { interopCatalog } from "./interop-catalog";

const surfaceId = "interop";

/** One surface: Angular Column/Row/Text/TextField/Slider/Button mixed with Lit Panel/Rating/Gauge. */
const OPERATIONS = [
  {
    version: "v0.9",
    createSurface: { surfaceId, catalogId: "copilotkit://angular-lit-interop" },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId,
      components: [
        {
          id: "root",
          component: "Column",
          children: ["title", "panels", "controls"],
        },
        {
          id: "title",
          component: "Text",
          text: "Angular and Lit in one A2UI surface",
          variant: "h2",
        },
        { id: "panels", component: "Row", children: ["feedback", "result"] },
        {
          id: "feedback",
          component: "Panel",
          title: "Lit panel with Angular children",
          tone: "info",
          children: ["prompt", "rating", "comment"],
        },
        { id: "prompt", component: "Text", text: "How was your stay?" },
        { id: "rating", component: "Rating", value: { path: "/score" } },
        {
          id: "comment",
          component: "TextField",
          label: "Comment",
          value: { path: "/comment" },
        },
        {
          id: "result",
          component: "Panel",
          title: "Lit gauge on the same data",
          tone: "success",
          children: ["gauge"],
        },
        {
          id: "gauge",
          component: "Gauge",
          label: "Score",
          value: { path: "/score" },
          max: 5,
        },
        {
          id: "controls",
          component: "Row",
          align: "center",
          children: ["slider", "submit"],
        },
        {
          id: "slider",
          component: "Slider",
          label: "Angular slider",
          min: 0,
          max: 5,
          value: { path: "/score" },
        },
        {
          id: "submit",
          component: "Button",
          variant: "primary",
          child: "submit-label",
          action: {
            event: {
              name: "submit_feedback",
              context: {
                score: { path: "/score" },
                comment: { path: "/comment" },
              },
            },
          },
        },
        { id: "submit-label", component: "Text", text: "Submit" },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId,
      path: "/",
      value: { score: 3, comment: "" },
    },
  },
];

@Component({
  selector: "a2ui-interop-demo",
  imports: [CopilotA2UISurface, JsonPipe],
  template: `
    <main class="page">
      <p class="intro">
        Every <strong>LIT</strong> box is a plain Lit web component inside the
        Angular renderer. The star rating (Lit), the gauge (Lit) and the slider
        (Angular) share <code>/score</code> in the A2UI data model, and the text
        inside the Lit panel is rendered by Angular into its
        <code>&lt;slot&gt;</code>.
      </p>
      <copilot-a2ui-surface
        [catalog]="catalog"
        [operations]="operations"
        (action)="actions.update((log) => [$event, ...log])"
      />
      <h3>Actions</h3>
      <pre data-testid="interop-actions">{{ actions() | json }}</pre>
    </main>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .page {
      max-width: 900px;
      margin: 0 auto;
      padding: 24px;
      font-family: system-ui, sans-serif;
    }
    .intro {
      color: #52525b;
      line-height: 1.5;
    }
    pre {
      padding: 12px;
      border-radius: 8px;
      background: #f4f4f5;
      font-size: 12px;
    }
  `,
})
export class A2UIInteropDemoComponent {
  protected readonly catalog = interopCatalog;
  protected readonly operations = OPERATIONS;
  protected readonly actions = signal<A2UIClientEventMessage[]>([]);
}
