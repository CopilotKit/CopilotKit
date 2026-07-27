import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
} from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "showcase-root",
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "showcase-root" },
  template: `
    <router-outlet />
  `,
})
export class AppComponent {
  private readonly shellReadyMark = "copilotkit:showcase-shell-ready";

  constructor() {
    afterNextRender(() => {
      globalThis.performance.mark(this.shellReadyMark);
    });
  }
}
