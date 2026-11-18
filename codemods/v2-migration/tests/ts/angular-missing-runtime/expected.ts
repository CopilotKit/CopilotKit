import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit as provideCopilot } from "@copilotkit/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    /* TODO(copilotkit-2.0): 2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. Add a `runtimeUrl` here. See https://docs.copilotkit.ai/migrate/providers-2.0#angular-a-missing-runtime-throws-in-production */ provideCopilot({
      headers: { Authorization: "Bearer token" },
      properties: { tenant: "acme" },
    }),
  ],
};

export const testProviders = [/* TODO(copilotkit-2.0): 2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. Add a `runtimeUrl` here. See https://docs.copilotkit.ai/migrate/providers-2.0#angular-a-missing-runtime-throws-in-production */ provideCopilot()];
