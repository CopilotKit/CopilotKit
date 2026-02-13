import { ChangeDetectionStrategy, Component } from "@angular/core";
import {
  CopilotChatView,
  provideCopilotChatLabels,
} from "@copilotkitnext/angular";
import { CustomChatInputComponent } from "../custom-input/custom-chat-input.component";

@Component({
  selector: "ukg-co-pilot-port",
  standalone: true,
  imports: [CopilotChatView],
  template: `
    <div style="display:block;height:100vh;">
      <copilot-chat-view [inputComponent]="customInput"></copilot-chat-view>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask anything... (UKG port)",
      chatDisclaimerText: "AI may be inaccurate (UKG PORT).",
    }),
  ],
})
export class CoPilotPortComponent {
  customInput = CustomChatInputComponent;
}
