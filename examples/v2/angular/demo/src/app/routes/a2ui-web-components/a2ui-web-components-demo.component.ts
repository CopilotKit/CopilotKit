import { JsonPipe } from "@angular/common";
import { Component, signal } from "@angular/core";
import type { A2UIClientEventMessage } from "@copilotkit/angular";
import { CopilotA2UISurface } from "@copilotkit/angular/a2ui";
import { webComponentsCatalog } from "./catalog";
import { CATALOG_ID } from "./definitions";

const surfaceId = "web-components";

/**
 * One surface: Angular basic components (Column, Row, Text, TextField,
 * Slider, Button), an Angular Panel, and the Rating and Gauge web components,
 * all sharing `/score` in the data model.
 */
const OPERATIONS = [
  { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
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
          text: "Angular components and web components in one A2UI surface",
          variant: "h2",
        },
        { id: "panels", component: "Row", children: ["feedback", "result"] },
        {
          id: "feedback",
          component: "Panel",
          title: "Angular panel with a web component inside",
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
          title: "Web component gauge on the same data",
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
  selector: "a2ui-web-components-demo",
  imports: [CopilotA2UISurface, JsonPipe],
  template: `
    <main class="page">
      <p class="intro">
        The star rating and the gauge are plain web components (<code
          >HTMLElement</code
        >
        with a shadow root, no framework) registered in the catalog with
        <code>{{ "{" }} tagName, element {{ "}" }}</code
        >. The panels, text field, slider and button are Angular components. The
        rating, gauge and slider all share <code>/score</code> in the A2UI data
        model, so changing one updates the others.
      </p>
      <copilot-a2ui-surface
        [catalog]="catalog"
        [operations]="operations"
        (action)="actions.update((log) => [$event, ...log])"
      />
      <h3>Actions</h3>
      <pre data-testid="web-components-actions">{{ actions() | json }}</pre>
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
export class A2UIWebComponentsDemoComponent {
  protected readonly catalog = webComponentsCatalog;
  protected readonly operations = OPERATIONS;
  protected readonly actions = signal<A2UIClientEventMessage[]>([]);
}
