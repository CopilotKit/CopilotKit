import type { ApplicationConfig } from "@angular/core";
import { importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { provideMCPApps } from "@copilotkit/angular/mcp-apps";
import { provideGenerativeUI } from "@copilotkit/angular/generative-ui";
import { provideGenerativeUIChart } from "@copilotkit/angular/generative-ui/chart";
import { provideGenerativeUIIcons } from "@copilotkit/angular/generative-ui/icons";
import { provideGenerativeUIMap } from "@copilotkit/angular/generative-ui/map";
import { shopUI } from "./routes/generative-ui/shop-ui";
import { CatalogAgent } from "./routes/generative-ui/catalog-agent";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";
import { a2uiDemoSandboxFunctions } from "./routes/a2ui/a2ui-demo-sandbox-functions";
import { dashboardCatalog } from "./routes/a2ui-angular/dashboard-catalog";
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
    // Native generative UI with the standard catalog (route /generative-ui).
    provideGenerativeUI({ ui: shopUI }),
    provideGenerativeUIChart(),
    provideGenerativeUIIcons(),
    provideGenerativeUIMap(),
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      licenseKey: "ck_pub_00000000000000000000000000000000",
      // The standard components page (/generative-ui/catalog) runs a scripted
      // agent in the browser.
      agents: { "generative-ui-catalog": new CatalogAgent(shopUI.id) },
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
      // Render A2UI with the basic catalog plus the dashboard components.
      a2ui: { catalog: dashboardCatalog },
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText:
        "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
