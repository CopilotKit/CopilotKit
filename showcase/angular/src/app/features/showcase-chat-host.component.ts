import type { AfterViewInit } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  inject,
  input,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { CopilotChat } from "@copilotkit/angular";

import { agentIdForFeature } from "../feature-agent";

@Component({
  selector: "showcase-chat-host",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "showcase-chat-host" },
  template: "",
})
export class ShowcaseChatHostComponent implements AfterViewInit {
  readonly agentId = input<string | undefined>();
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly route = inject(ActivatedRoute);

  ngAfterViewInit(): void {
    const chat = this.viewContainer.createComponent(CopilotChat);
    const feature =
      (this.route.snapshot.data["feature"] as string | undefined) ?? "default";
    chat.setInput("agentId", this.agentId() ?? agentIdForFeature(feature));
  }
}
