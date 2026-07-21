import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "./feature-header.component";

@Component({
  selector: "showcase-chat-css-feature",
  imports: [CopilotChat, FeatureHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: "feature-page chat-css-demo-scope" },
  template: `
    <showcase-feature-header />
    <main class="chat-surface" [attr.aria-label]="demoLabel">
      <copilot-chat />
    </main>
  `,
  styles: `
    .chat-css-demo-scope .copilotKitUserMessage {
      color: #fff;
      background: rgb(255, 0, 110);
      border-radius: 0.75rem;
    }

    .chat-css-demo-scope .copilotKitAssistantMessage {
      padding: 0.75rem;
      color: #3f2d00;
      background: rgb(253, 224, 71);
      border-radius: 0.75rem;
    }
  `,
})
export class ChatCssFeatureComponent {
  protected readonly demoLabel = "CSS-customized CopilotKit chat";
}
