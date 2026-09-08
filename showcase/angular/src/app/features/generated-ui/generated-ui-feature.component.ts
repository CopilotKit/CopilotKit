import { ChangeDetectionStrategy, Component } from "@angular/core";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";

@Component({
  selector: "showcase-generated-ui-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="generated-ui-feature-page">
      <section
        class="chat-surface"
        aria-label="Angular protocol-rendered UI demonstration"
      >
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class GeneratedUIFeatureComponent {
  protected readonly demoLabel = "Protocol-rendered UI demonstration";
}
