import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";
import { z } from "zod";
import { Airport, Arrow } from "./flight-components";
import { createGenerativeUI, standardUI, provideGenerativeUI } from "@copilotkit/angular/generative-ui";

export const myCatalog = createGenerativeUI({
  id: "acme/flights",
  extends: [standardUI],
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 Angular component. In 2.0 it gets each prop as an input with its resolved value, child components as `GenerativeUIChildren` inputs, and an event input or a `registerGenerativeUIFunction` function replaces `dispatch` from `injectA2UIComponentContext()`. Update the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Airport: {
      component: Airport,
      description: "An airport by IATA code, with its city under it.",
      props: z.object({ code: z.string(), city: z.string() }),
    },
    // TODO(copilotkit-2.0): This was a v0.9 Angular component. In 2.0 it gets each prop as an input with its resolved value, child components as `GenerativeUIChildren` inputs, and an event input or a `registerGenerativeUIFunction` function replaces `dispatch` from `injectA2UIComponentContext()`. Update the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    // TODO(copilotkit-2.0): Add a `description` to this component. The agent reads it to choose the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Arrow: {
      component: Arrow,
      props: z.object({}),
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({
      runtimeUrl: "/api/copilotkit",
    }),
    provideGenerativeUI({ ui: myCatalog }),
  ],
};

export const basicConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({ runtimeUrl: "/api/copilotkit" }),
  ],
};

export const notInArray = provideCopilotKit({
  runtimeUrl: "/api/copilotkit",
  // TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0. Add `provideGenerativeUI({ ui })` from "@copilotkit/angular/generative-ui" next to `provideCopilotKit`, with a UI from `createGenerativeUI`, and delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
  a2ui: { catalog: myCatalog },
});
