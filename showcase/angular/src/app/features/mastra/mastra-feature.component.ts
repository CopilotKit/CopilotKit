import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  registerRenderActivityMessage,
  registerRenderToolCall,
} from "@copilotkit/angular";
import { z } from "zod";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import {
  asBrowseRenderer,
  backgroundTaskActivityRendererConfig,
  BrowseResultsToolCard,
  observationalMemoryActivityRendererConfig,
} from "./mastra-cards";

@Component({
  selector: "showcase-mastra-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="mastra-feature-page">
      <section class="chat-surface" aria-label="Angular Mastra demonstration">
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class MastraFeatureComponent {
  private readonly feature =
    (inject(ActivatedRoute).snapshot.data["feature"] as string | undefined) ??
    "unknown";

  constructor() {
    switch (this.feature) {
      case "background-agents":
        registerRenderActivityMessage(backgroundTaskActivityRendererConfig);
        break;
      case "observational-memory":
        registerRenderActivityMessage(
          observationalMemoryActivityRendererConfig,
        );
        break;
      case "browser-use":
        registerRenderToolCall({
          name: "browse_web",
          args: z.object({ task: z.string() }),
          component: asBrowseRenderer(BrowseResultsToolCard),
        });
        break;
    }
  }
}
