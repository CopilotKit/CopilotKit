import { ChangeDetectionStrategy, Component } from "@angular/core";

import frontendCatalogData from "../generated/frontend-catalog.json";
import { resolveBrowserCell } from "../cell-context";
import type { BrowserCellCatalog } from "../cell-context";

@Component({
  selector: "showcase-unavailable-feature",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "status-page" },
  template: `
    <main role="alert" class="status-panel">
      <h1>
        {{
          cell.kind === "unavailable" ? "Demo unavailable" : "Invalid demo route"
        }}
      </h1>
      <p>{{ reason }}</p>
      @if (cell.kind === "unavailable") {
        <code>{{ cell.cellId }}</code>
      }
    </main>
  `,
})
export class UnavailableFeatureComponent {
  protected readonly cell = resolveBrowserCell(
    typeof globalThis.location === "undefined"
      ? ""
      : globalThis.location.pathname,
    frontendCatalogData as BrowserCellCatalog,
  );
  protected readonly reason =
    this.cell.kind === "runnable"
      ? "This route unexpectedly resolved as runnable."
      : this.cell.reason;
}
