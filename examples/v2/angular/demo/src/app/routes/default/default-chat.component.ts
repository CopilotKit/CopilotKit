// oxlint-disable typescript/no-extraneous-class -- Angular decorated component
import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChat } from "@copilotkit/angular";

@Component({
  selector: "default-chat",
  standalone: true,
  imports: [CommonModule, CopilotChat],
  template: `
    <copilot-chat [threadId]="'xyz'"></copilot-chat>
  `,
})
// oxlint-disable-next-line typescript/no-extraneous-class
export class DefaultChatComponent {}
