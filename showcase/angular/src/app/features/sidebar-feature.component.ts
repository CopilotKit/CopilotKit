import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotSidebar } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "./feature-header.component";

@Component({
  selector: "showcase-sidebar-feature",
  imports: [CopilotSidebar, FeatureHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="shell-demo-content" [attr.aria-label]="demoLabel">
      <section>
        <p class="feature-eyebrow">Prebuilt surface</p>
        <h2>A docked Copilot</h2>
        <p>The application and assistant remain visible side by side.</p>
      </section>
      <copilot-sidebar />
    </main>
  `,
})
export class SidebarFeatureComponent {
  protected readonly demoLabel = "Sidebar chat demonstration";
}
