import { Component, ChangeDetectionStrategy } from "@angular/core";

import { CopilotChat } from "@copilotkit/angular";

@Component({
  selector: "default-chat",
  standalone: true,
  imports: [CopilotChat],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <copilot-chat [threadId]="'xyz'" />
  `,
})
export class DefaultChatComponent {}
