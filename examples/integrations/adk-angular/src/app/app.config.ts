import type { ApplicationConfig } from "@angular/core";
import { provideZonelessChangeDetection } from "@angular/core";
import {
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";

// Agent id registered in server.ts (`agents: { default: ... }`) and used by
// <copilot-chat> / the threads drawer / injectAgentStore throughout the app.
export const AGENT_ID = "default";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideCopilotKit({
      runtimeUrl: "http://localhost:8200/api/copilotkit",
    }),
    // Owns the active thread the SDK threads drawer drives (the Angular analog
    // of React's CopilotChatConfigurationProvider). Uncontrolled (no threadId)
    // so the drawer's "+ New" can reset to a fresh thread.
    provideCopilotChatConfiguration({ agentId: AGENT_ID }),
  ],
};
