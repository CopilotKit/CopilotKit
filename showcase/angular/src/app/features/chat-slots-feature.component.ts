import type { AfterViewInit } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  inject,
  input,
} from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

import { agentIdForFeature } from "../feature-agent";
import { FeatureHeaderComponent } from "./feature-header.component";

interface SlotMessage {
  id: string;
  role: "assistant";
  content?: string;
}

@Component({
  selector: "showcase-custom-assistant-message",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "custom-assistant-message",
    "data-testid": "custom-assistant-message",
    "data-slot-label": "MessageView.AssistantMessage",
    "data-message-role": "assistant",
  },
  template: `
    <p class="feature-eyebrow">Custom Angular assistant slot</p>
    <div>{{ message().content }}</div>
  `,
})
export class CustomAssistantMessageComponent {
  readonly message = input.required<SlotMessage>();
}

@Component({
  selector: "showcase-chat-slots-feature",
  imports: [FeatureHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="chat-surface" aria-label="Customized CopilotKit chat">
      <ng-container #chatHost />
    </main>
  `,
})
export class ChatSlotsFeatureComponent implements AfterViewInit {
  private readonly chatHost = inject(ViewContainerRef);

  ngAfterViewInit(): void {
    const chat = this.chatHost.createComponent(CopilotChat);
    chat.setInput("agentId", agentIdForFeature("chat-slots"));
    chat.setInput("assistantMessageComponent", CustomAssistantMessageComponent);
  }
}
