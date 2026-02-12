import { ApplicationConfig, importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkitnext/angular";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      renderToolCalls: [
        {
          name: "*",
          component: WildcardToolRenderComponent,
        } as any,
      ],
      frontendTools: [],
      humanInTheLoop: [],
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText:
        "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
