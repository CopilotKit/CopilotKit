import { Component } from "@angular/core";
import {
  CopilotKitConfigDirective,
  CopilotChatComponent,
} from "@copilotkitnext/angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CopilotKitConfigDirective, CopilotChatComponent],
  template: `
    <div
      [copilotkitConfig]="{ runtimeUrl: runtimeUrl }"
      style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; display: block;"
    >
      <copilot-chat></copilot-chat>
    </div>
  `,
})
export class AppComponent {
  runtimeUrl = "http://localhost:3001/api/copilotkit";
}
