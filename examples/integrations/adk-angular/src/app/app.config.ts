import type { ApplicationConfig } from "@angular/core";
import { provideZonelessChangeDetection } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";

// Agent id registered in server.ts (`agents: { default: ... }`) and used by
// <copilot-chat> / the threads drawer / injectAgentStore throughout the app.
export const AGENT_ID = "default";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideCopilotKit({
      runtimeUrl: "http://localhost:8200/api/copilotkit",
    }),
  ],
};
