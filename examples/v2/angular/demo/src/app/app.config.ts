import type { ApplicationConfig } from "@angular/core";
import { importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";
import { a2uiDemoSandboxFunctions } from "./routes/a2ui/a2ui-demo-sandbox-functions";
import { dashboardCatalog } from "./routes/a2ui-angular/dashboard-catalog";
import { routes } from "./app.routes";
import { z } from "zod";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideRouter(routes),
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
          consumerAgentId: "a2ui-recovery",
          available: "always",
          suggestions: [
            {
              title: "Recover after a retry",
              message: "Show the weekly signups dashboard",
            },
            {
              title: "Fail every attempt",
              message: "Show a dashboard that fails every attempt",
            },
          ],
        },
        {
          instructions:
            "Suggest follow-up tasks based on the current page content",
          available: "always",
        },
      ],
      humanInTheLoop: [],
      openGenerativeUI: { sandboxFunctions: a2uiDemoSandboxFunctions },
      // Render A2UI with Angular components: the basic catalog plus the
      // dashboard components. Omit to use the default Lit renderer.
      a2ui: { catalog: dashboardCatalog },
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText:
        "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
