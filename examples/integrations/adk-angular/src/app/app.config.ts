import type { ApplicationConfig } from "@angular/core";
import { provideZonelessChangeDetection } from "@angular/core";
import {
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";
import { WeatherCard, weatherArgs } from "./weather-card";

// Agent id registered in server.ts (`agents: { default: ... }`) and used by
// <copilot-chat> / the threads drawer / injectAgentStore throughout the app.
export const AGENT_ID = "default";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideCopilotKit({
      runtimeUrl: "http://localhost:8200/api/copilotkit",
      // 🪁 Generative UI: render a card whenever the agent calls `get_weather`.
      renderToolCalls: [
        { name: "get_weather", args: weatherArgs, component: WeatherCard },
      ],
      // 🪁 Suggestions: static prompt pills shown above the composer.
      suggestionsConfig: [
        {
          available: "always",
          suggestions: [
            {
              title: "Generative UI",
              message: "Get the weather in San Francisco.",
            },
            { title: "Frontend Tools", message: "Set the theme to green." },
            { title: "Write Agent State", message: "Add a proverb about AI." },
            {
              title: "Update Agent State",
              message:
                "Please remove 1 random proverb from the list if there are any.",
            },
            { title: "Read Agent State", message: "What are the proverbs?" },
          ],
        },
      ],
    }),
    // Owns the active thread the SDK threads drawer drives (the Angular analog
    // of React's CopilotChatConfigurationProvider). Uncontrolled (no threadId)
    // so the drawer's "+ New" can reset to a fresh thread.
    provideCopilotChatConfiguration({ agentId: AGENT_ID }),
  ],
};
