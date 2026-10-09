import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { CopilotChatInput, injectChatState } from "@copilotkit/angular";
import type { ToolsMenuItem } from "@copilotkit/angular";

@Component({
  selector: "a2ui-demo-input",
  standalone: true,
  imports: [CopilotChatInput],
  template: `
    <copilot-chat-input [inputClass]="inputClass() ?? ''" [toolsMenu]="toolsMenu" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class A2UIDemoInputComponent {
  readonly inputClass = input<string | undefined>();
  private readonly chatState = injectChatState();

  readonly toolsMenu: (ToolsMenuItem | "-")[] = [
    {
      label: "Say hi to CopilotKit",
      action: () => {
        this.chatState.changeInput(
          "Hello Copilot! 👋 Could you help me with something?",
        );
      },
    },
    "-",
    {
      label: "Open CopilotKit Docs",
      action: () => {
        window.open(
          "https://docs.copilotkit.ai",
          "_blank",
          "noopener,noreferrer",
        );
      },
    },
  ];
}
