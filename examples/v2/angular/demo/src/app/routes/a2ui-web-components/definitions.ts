import { z } from "zod";
import type { A2UICatalogDefinitions } from "@copilotkit/angular/a2ui";
import { ChildListSchema, DynamicNumberSchema } from "@copilotkit/angular/a2ui";

export const CATALOG_ID = "copilotkit://angular-web-components";

/** Panel is an Angular component; Rating and Gauge are plain web components. */
export const definitions = {
  Panel: {
    description: "An Angular panel whose children are A2UI components.",
    props: z.object({
      title: z.string(),
      tone: z.enum(["info", "success"]).optional(),
      children: ChildListSchema,
    }),
  },
  Rating: {
    description: "A web component star rating bound to the data model.",
    props: z.object({ value: DynamicNumberSchema }),
  },
  Gauge: {
    description: "A web component half-circle gauge.",
    props: z.object({
      label: z.string(),
      value: DynamicNumberSchema,
      max: z.number().optional(),
    }),
  },
} satisfies A2UICatalogDefinitions;
