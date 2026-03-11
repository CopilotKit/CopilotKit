import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChat } from "@copilotkitnext/angular";

@Component({
  selector: "default-chat",
  standalone: true,
  imports: [CommonModule, CopilotChat],
  template: ` <copilot-chat [threadId]="'xyz'"></copilot-chat> `,
})
export class DefaultChatComponent {}
