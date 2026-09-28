import { CUSTOM_ELEMENTS_SCHEMA, Component, input } from "@angular/core";
import { z } from "zod";
import {
  ChildListSchema,
  CopilotA2UIChild,
  DynamicNumberSchema,
  createAngularCatalog,
} from "@copilotkit/angular/a2ui";
import type {
  A2UICatalogDefinitions,
  A2UIProps,
} from "@copilotkit/angular/a2ui";
import { defineDemoLitElements } from "./lit-elements";

defineDemoLitElements();

export const interopDefinitions = {
  Panel: {
    description: "A Lit panel whose children are A2UI components.",
    props: z.object({
      title: z.string(),
      tone: z.enum(["info", "success", "warning"]).optional(),
      children: ChildListSchema,
    }),
  },
  Rating: {
    description: "A Lit star rating bound to the data model.",
    props: z.object({ value: DynamicNumberSchema }),
  },
  Gauge: {
    description: "A Lit half-circle gauge.",
    props: z.object({
      label: z.string(),
      value: DynamicNumberSchema,
      max: z.number().optional(),
    }),
  },
} satisfies A2UICatalogDefinitions;

type Props<K extends keyof typeof interopDefinitions> = A2UIProps<
  typeof interopDefinitions,
  K
>;

/** Angular renders the A2UI children into the Lit panel's `<slot>`. */
@Component({
  selector: "demo-a2ui-panel",
  imports: [CopilotA2UIChild],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { style: "display: contents" },
  template: `
    <demo-lit-panel [heading]="props().title" [tone]="props().tone ?? 'info'">
      @for (child of props().children; track $index) {
        <copilot-a2ui-child [child]="child" />
      }
    </demo-lit-panel>
  `,
})
export class PanelComponent {
  readonly props = input.required<Props<"Panel">>();
}

/** The Lit element's DOM event writes back to the A2UI data model. */
@Component({
  selector: "demo-a2ui-rating",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { style: "display: contents" },
  template: `
    <demo-lit-rating [value]="props().value" (rating-change)="rate($event)" />
  `,
})
export class RatingComponent {
  readonly props = input.required<Props<"Rating">>();

  protected rate(event: Event): void {
    this.props().setValue((event as CustomEvent<number>).detail);
  }
}

@Component({
  selector: "demo-a2ui-gauge",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { style: "display: contents" },
  template: `
    <demo-lit-gauge
      [label]="props().label"
      [value]="props().value"
      [max]="props().max ?? 100"
    />
  `,
})
export class GaugeComponent {
  readonly props = input.required<Props<"Gauge">>();
}

/** Angular basic components plus Lit elements, in one catalog. */
export const interopCatalog = createAngularCatalog(
  interopDefinitions,
  { Panel: PanelComponent, Rating: RatingComponent, Gauge: GaugeComponent },
  { catalogId: "copilotkit://angular-lit-interop", includeBasicCatalog: true },
);
