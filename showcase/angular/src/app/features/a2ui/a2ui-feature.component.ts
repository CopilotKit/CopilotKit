import { ChangeDetectionStrategy, Component } from "@angular/core";

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
}
