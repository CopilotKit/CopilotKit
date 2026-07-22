import type { AfterViewInit, ComponentRef, Type } from "@angular/core";
import type { AttachmentsConfig } from "@copilotkit/angular";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewContainerRef,
  inject,
  input,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  CopilotChat,
  CopilotKit,
  provideCopilotChatLabels,
} from "@copilotkit/angular";

import { agentIdForRoute, threadIdForFeature } from "../feature-agent";
import { renderDynamicComponent } from "./render-dynamic-component";
import { populateChatInput } from "./showcase-chat-host-model";

@Component({
  selector: "showcase-chat-host",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "showcase-chat-host" },
  template: "",
})
export class ShowcaseChatHostComponent implements AfterViewInit {
  readonly agentId = input<string | undefined>();
  readonly chatPlaceholder = input<string | undefined>();
  readonly reasoningMessageComponent = input<Type<unknown> | undefined>();
  readonly messageViewChildrenComponent = input<Type<unknown> | undefined>();
  readonly headers = input<Record<string, string> | undefined>();
  readonly attachments = input<AttachmentsConfig | undefined>();
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private chat: ComponentRef<CopilotChat> | undefined;

  ngAfterViewInit(): void {
    const headers = this.headers();
    if (headers) {
      this.injector.get(CopilotKit).updateRuntime({ headers });
    }
    const placeholder = this.chatPlaceholder();
    const childInjector = placeholder
      ? Injector.create({
          parent: this.injector,
          providers: [
            provideCopilotChatLabels({ chatInputPlaceholder: placeholder }),
          ],
        })
      : undefined;
    if (childInjector) {
      this.destroyRef.onDestroy(() => childInjector.destroy());
    }
    const chat = this.viewContainer.createComponent(CopilotChat, {
      injector: childInjector,
    });
    this.chat = chat;
    const feature =
      (this.route.snapshot.data["feature"] as string | undefined) ?? "default";
    chat.setInput(
      "agentId",
      this.agentId() ?? agentIdForRoute(feature, this.route),
    );
    const threadId = threadIdForFeature(feature);
    if (threadId !== undefined) chat.setInput("threadId", threadId);
    chat.setInput(
      "reasoningMessageComponent",
      this.reasoningMessageComponent(),
    );
    chat.setInput(
      "messageViewChildrenComponent",
      this.messageViewChildrenComponent(),
    );
    chat.setInput("attachments", this.attachments());
    renderDynamicComponent(chat);
  }

  /** Populate and focus the signal-backed composer created by this host. */
  populateComposer(value: string): boolean {
    const populated = populateChatInput(this.chat?.instance, value);
    if (populated) {
      queueMicrotask(() => {
        this.host.nativeElement
          .querySelector<HTMLTextAreaElement>(
            '[data-testid="copilot-chat-textarea"]',
          )
          ?.focus();
      });
    }
    return populated;
  }
}
