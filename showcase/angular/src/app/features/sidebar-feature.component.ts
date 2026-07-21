import type { AfterViewInit } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  viewChild,
} from "@angular/core";
import { CopilotSidebar } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "./feature-header.component";
import { renderDynamicComponent } from "./render-dynamic-component";
import { ShowcaseChatHostComponent } from "./showcase-chat-host.component";

@Component({
  selector: "showcase-sidebar-feature",
  imports: [FeatureHeaderComponent],
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
      <ng-container #sidebarHost />
    </main>
  `,
})
export class SidebarFeatureComponent implements AfterViewInit {
  protected readonly demoLabel = "Sidebar chat demonstration";
  private readonly sidebarHost = viewChild.required("sidebarHost", {
    read: ViewContainerRef,
  });

  ngAfterViewInit(): void {
    const sidebar = this.sidebarHost().createComponent(CopilotSidebar);
    sidebar.setInput("chatComponent", ShowcaseChatHostComponent);
    renderDynamicComponent(sidebar);
  }
}
