import { Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { filter, map, startWith } from "rxjs";

import { DemoWebInspectorComponent } from "./components/demo-web-inspector.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, DemoWebInspectorComponent],
  template: `
    <div class="demo-shell">
      <router-outlet />
      @if (showInspector()) {
        <angular-demo-web-inspector />
      }
    </div>
  `,
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
export class AppComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * The web inspector is shown on every route except those that opt out via
   * `data: { inspector: false }` (currently the headless route).
   */
  protected readonly showInspector = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.inspectorEnabled()),
      startWith(this.inspectorEnabled()),
    ),
    { initialValue: true },
  );

  private inspectorEnabled(): boolean {
    let route = this.route;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.snapshot.data["inspector"] !== false;
  }
}
