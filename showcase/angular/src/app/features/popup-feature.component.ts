import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotPopup } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "./feature-header.component";

@Component({
  selector: "showcase-popup-feature",
  imports: [CopilotPopup, FeatureHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="shell-demo-content" [attr.aria-label]="demoLabel">
      <section>
        <p class="feature-eyebrow">Prebuilt surface</p>
        <h2>Chat from anywhere</h2>
        <p>The popup stays available while the application remains usable.</p>
      </section>
      <copilot-popup />
    </main>
  `,
})
export class PopupFeatureComponent {
  protected readonly demoLabel = "Popup chat demonstration";
}
