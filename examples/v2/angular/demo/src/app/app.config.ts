import type { ApplicationConfig } from "@angular/core";
import { importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { provideMCPApps } from "@copilotkit/angular/mcp-apps";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";
import { a2uiDemoSandboxFunctions } from "./routes/a2ui/a2ui-demo-sandbox-functions";
import { routes } from "./app.routes";
import { z } from "zod";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideRouter(routes),
    // MCP Apps stays an opt-in secondary entry point of the package; the demo
    // opts in once at the root because the activity renderer is resolved from
    // the root injector (a lazy-route provider would never be seen).
    provideMCPApps(),
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      licenseKey: "ck_pub_00000000000000000000000000000000",
      renderToolCalls: [
        {
          name: "*",
          args: z.record(z.string(), z.unknown()),
          component: WildcardToolRenderComponent,
        },
      ],
      suggestionsConfig: [
        {
          instructions:
            "Suggest follow-up tasks based on the current page content",
          available: "always",
        },
      ],
      humanInTheLoop: [],
      openGenerativeUI: { sandboxFunctions: a2uiDemoSandboxFunctions },
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText:
        "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
