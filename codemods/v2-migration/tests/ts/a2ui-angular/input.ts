import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";
import { z } from "zod-v3";
import {
  createAngularCatalog,
  DynamicStringSchema,
  basicCatalog,
} from "@copilotkit/angular/a2ui";
import { Airport, Arrow } from "./flight-components";

const definitions = {
  Airport: {
    description: "An airport by IATA code, with its city under it.",
    props: z.object({ code: DynamicStringSchema, city: DynamicStringSchema }),
  },
  Arrow: { props: z.object({}) },
};
const renderers = { Airport, Arrow };
export const myCatalog = createAngularCatalog(definitions, renderers, {
  catalogId: "acme/flights",
  includeBasicCatalog: true,
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({
      runtimeUrl: "/api/copilotkit",
      a2ui: { catalog: myCatalog },
    }),
  ],
};

export const basicConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({ runtimeUrl: "/api/copilotkit", a2ui: { catalog: basicCatalog } }),
  ],
};

export const notInArray = provideCopilotKit({
  runtimeUrl: "/api/copilotkit",
  a2ui: { catalog: myCatalog },
});
