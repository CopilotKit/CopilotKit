import { Component } from "@angular/core";

import { CopilotChat } from "@copilotkitnext/angular";

@Component({
  selector: "default-chat",
  standalone: true,
  imports: [CopilotChat],
  template: `
    <copilot-chat [threadId]="'xyz'" />
  `,
})
export class DefaultChatComponent {}
