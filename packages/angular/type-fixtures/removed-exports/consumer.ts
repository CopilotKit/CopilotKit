/** A 1.x Angular app that uses exports that CopilotKit 2.0 removed. */
import { Component } from "@angular/core";
import {
  CopilotA2UIRecovery,
  readA2UILifecycleContent,
} from "@copilotkit/angular";
import type { A2UIConfig } from "@copilotkit/angular";

@Component({
  selector: "app-chat",
  // @ts-expect-error Add provideGenerativeUI({ ui }) from @copilotkit/angular/generative-ui
  imports: [CopilotA2UIRecovery],
  template: "",
})
export class ChatComponent {
  readonly title = "Chat";
}

// @ts-expect-error Add provideGenerativeUI({ ui }) from @copilotkit/angular/generative-ui
export const lifecycle = readA2UILifecycleContent({ status: "ready" });

// @ts-expect-error The A2UI v0.9 renderer was removed
export const config: A2UIConfig = { catalog: {} };
