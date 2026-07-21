import { Component, input } from "@angular/core";
import { Proverbs } from "./proverbs";

@Component({
  selector: "app-main-content",
  standalone: true,
  imports: [Proverbs],
  template: `
    <div
      class="main-content"
      [style.--copilot-kit-primary-color]="themeColor()"
      [style.background-color]="themeColor()"
    >
      <app-proverbs />
    </div>
  `,
  styles: [
    `
      .main-content {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        transition: background-color 0.3s ease;
        overflow: auto;
      }
    `,
  ],
})
export class MainContent {
  readonly themeColor = input<string>("#6366f1");
}
