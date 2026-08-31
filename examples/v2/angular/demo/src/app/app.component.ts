import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="demo-shell">
      <router-outlet />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .demo-shell {
      height: 100vh;
      width: 100vw;
      margin: 0;
      padding: 0;
      overflow: hidden;
      display: block;
    }
  `,
})
export class AppComponent {}
