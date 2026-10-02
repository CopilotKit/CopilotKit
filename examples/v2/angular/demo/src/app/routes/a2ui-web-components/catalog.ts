import { Component, input } from "@angular/core";
import type { A2UIProps } from "@copilotkit/angular/a2ui";
import {
  CopilotA2UIChild,
  createAngularCatalog,
} from "@copilotkit/angular/a2ui";
import { CATALOG_ID, definitions } from "./definitions";
import { GaugeElement, RatingElement } from "./elements";

/** An Angular component that renders A2UI children, web components included. */
@Component({
  selector: "demo-a2ui-panel",
  imports: [CopilotA2UIChild],
  host: { style: "display: contents" },
  template: `
    <section class="panel" [class.success]="props().tone === 'success'">
      <header><span class="badge">Angular</span>{{ props().title }}</header>
      <div class="body">
        @for (child of props().children; track $index) {
          <copilot-a2ui-child [child]="child" />
        }
      </div>
    </section>
  `,
  styles: `
    .panel {
      --tone: #2563eb;
      flex: 1;
      min-width: 0;
      margin: 8px;
      border: 1px solid var(--tone);
      border-radius: 12px;
      background: color-mix(in srgb, var(--tone) 6%, white);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
    }
    .panel.success {
      --tone: #16a34a;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--tone) 30%, white);
      color: var(--tone);
      font:
        600 13px/1.2 system-ui,
        sans-serif;
    }
    .badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--tone);
      color: white;
      font-size: 10px;
      letter-spacing: 0.05em;
    }
  `,
})
export class PanelComponent {
  readonly props = input.required<A2UIProps<typeof definitions, "Panel">>();
}

/** Angular basic components, an Angular panel and two web components in one catalog. */
export const webComponentsCatalog = createAngularCatalog(
  definitions,
  {
    Panel: PanelComponent,
    Rating: { tagName: "demo-a2ui-rating", element: RatingElement },
    Gauge: { tagName: "demo-a2ui-gauge", element: GaugeElement },
  },
  { catalogId: CATALOG_ID, includeBasicCatalog: true },
);
