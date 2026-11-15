import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { connectAgentContext } from "@copilotkit/angular";

import {
  dashboardCompositionContext,
  salesDatasetContext,
} from "../../../../../integrations/_shared/ts/a2ui/sales-context";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";

@Component({
  selector: "showcase-a2ui-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="a2ui-feature-page">
      <section class="chat-surface" aria-label="Angular A2UI demonstration">
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class A2UIFeatureComponent {
  protected readonly demoLabel = "Angular A2UI demonstration";
  private readonly feature = inject(ActivatedRoute).snapshot.data["feature"];

  constructor() {
    if (this.feature === "declarative-gen-ui") {
      connectAgentContext(salesDatasetContext);
      connectAgentContext(dashboardCompositionContext);
    }
  }
}
