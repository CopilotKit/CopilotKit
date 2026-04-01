import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  CopilotChatView,
  CopilotChat,
  provideCopilotChatLabels,
} from "@copilotkitnext/angular";
import { CustomChatInputComponent } from "./custom-chat-input.component";

@Component({
  selector: "nextgen-custom-input-chat",
  standalone: true,
  imports: [CommonModule, CopilotChat],
  template: `
    <div style="display:block;height:100vh;">
      <copilot-chat [inputComponent]="customInput"></copilot-chat>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // Optional: tweak labels/placeholders shown by CopilotKit
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask anything...",
      chatDisclaimerText: "AI can make mistakes. Verify important info.",
    }),
  ],
})
export class CustomInputChatComponent {
  customInput = CustomChatInputComponent;
}
