import type { AfterViewInit, Type } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  ViewContainerRef,
  inject,
  input,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkit/angular";

import { agentIdForFeature } from "../feature-agent";

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
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  ngAfterViewInit(): void {
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
    const feature =
      (this.route.snapshot.data["feature"] as string | undefined) ?? "default";
    chat.setInput("agentId", this.agentId() ?? agentIdForFeature(feature));
    chat.setInput(
      "reasoningMessageComponent",
      this.reasoningMessageComponent(),
    );
  }
}
