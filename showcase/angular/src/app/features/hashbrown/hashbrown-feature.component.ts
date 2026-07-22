import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
  ViewContainerRef,
} from "@angular/core";
import type { AfterViewInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { CopilotChat } from "@copilotkit/angular";

import { agentIdForRoute } from "../../feature-agent";
import { renderDynamicComponent } from "../render-dynamic-component";
import { HashbrownAssistantMessage } from "./hashbrown-assistant-message.component";

@Component({
  selector: "showcase-hashbrown-feature",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <header class="feature-header">
      <div>
        <h1>Declarative UI: Hashbrown</h1>
        <p>{{ cellId() }}</p>
      </div>
      <span class="framework-badge">Angular</span>
    </header>
    <main class="chat-surface" aria-label="Hashbrown generative UI demo">
      <ng-container #chatHost />
    </main>
  `,
})
export class HashbrownFeatureComponent implements AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly chatHost = viewChild.required("chatHost", {
    read: ViewContainerRef,
  });
  protected readonly cellId = computed(
    () =>
      `angular/${this.route.snapshot.paramMap.get("integration") ?? "unknown"}/${this.route.snapshot.data["feature"] ?? "unknown"}`,
  );

  /** Create the prebuilt chat and attach the framework-native message slot. */
  ngAfterViewInit(): void {
    const chat = this.chatHost().createComponent(CopilotChat);
    chat.setInput(
      "agentId",
      agentIdForRoute("declarative-hashbrown", this.route),
    );
    chat.setInput("assistantMessageComponent", HashbrownAssistantMessage);
    renderDynamicComponent(chat);
  }
}
