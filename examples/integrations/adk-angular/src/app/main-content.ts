import { Component, input } from "@angular/core";

@Component({
  selector: "app-main-content",
  standalone: true,
  template: `
    <div
      class="main-content"
      [style.--copilot-kit-primary-color]="themeColor()"
      [style.background-color]="themeColor()"
    >
      <!-- proverbs (A6) + weather (A7) render here -->
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
