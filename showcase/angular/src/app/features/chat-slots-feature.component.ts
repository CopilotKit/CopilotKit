import type { AfterViewInit } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  ViewContainerRef,
  inject,
  input,
  inputBinding,
} from "@angular/core";
import {
  CopilotChat,
  provideCopilotChatConfiguration,
} from "@copilotkit/angular";

import { agentIdForCurrentIntegration } from "../feature-agent";
import { FeatureHeaderComponent } from "./feature-header.component";
import {
  createDynamicComponent,
  renderDynamicComponent,
} from "./render-dynamic-component";

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
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  ngAfterViewInit(): void {
    const agentId = agentIdForCurrentIntegration("chat-slots");
    const childInjector = Injector.create({
      parent: this.injector,
      providers: [...provideCopilotChatConfiguration({ agentId })],
    });
    this.destroyRef.onDestroy(() => childInjector.destroy());
    const chat = createDynamicComponent(this.chatHost, CopilotChat, {
      injector: childInjector,
      bindings: [
        inputBinding("agentId", () => agentId),
        inputBinding(
          "assistantMessageComponent",
          () => CustomAssistantMessageComponent,
        ),
      ],
    });
    renderDynamicComponent(chat);
  }
}
