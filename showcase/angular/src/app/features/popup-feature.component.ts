import type { AfterViewInit } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  viewChild,
} from "@angular/core";
import { CopilotPopup } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "./feature-header.component";
import { renderDynamicComponent } from "./render-dynamic-component";
import { ShowcaseChatHostComponent } from "./showcase-chat-host.component";

@Component({
  selector: "showcase-popup-feature",
  imports: [FeatureHeaderComponent],
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
      <ng-container #popupHost />
    </main>
  `,
})
export class PopupFeatureComponent implements AfterViewInit {
  protected readonly demoLabel = "Popup chat demonstration";
  private readonly popupHost = viewChild.required("popupHost", {
    read: ViewContainerRef,
  });

  ngAfterViewInit(): void {
    const popup = this.popupHost().createComponent(CopilotPopup);
    popup.setInput("chatComponent", ShowcaseChatHostComponent);
    renderDynamicComponent(popup);
  }
}
