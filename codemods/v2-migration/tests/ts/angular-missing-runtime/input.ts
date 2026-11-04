import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit as provideCopilot } from "@copilotkit/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilot({
      headers: { Authorization: "Bearer token" },
      properties: { tenant: "acme" },
    }),
  ],
};

export const testProviders = [provideCopilot()];
