import { NgComponentOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  Type,
  input,
  output,
} from "@angular/core";

import { CopilotIcon, History, X } from "../icons/copilot-icon";

const TITLE_COLUMN =
  "cpk:flex cpk:min-w-0 cpk:flex-1 cpk:justify-center cpk:text-center";

const ICON_BUTTON =
  "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-lg cpk:border-0 cpk:bg-transparent cpk:p-0 cpk:text-muted-foreground cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring/50";

/**
 * Header shared by `<copilot-popup>` and `<copilot-sidebar>`, matching React's
 * `CopilotModalHeader`: optional threads launcher on the left, centered title
 * (or a custom `headerComponent`), close button on the right.
 */
@Component({
  selector: "header[copilotModalHeader]",
  imports: [NgComponentOutlet, CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      "copilotKitHeader cpk:flex cpk:h-14 cpk:shrink-0 cpk:items-center cpk:justify-between cpk:border-b cpk:border-border cpk:px-3 cpk:bg-background/95 cpk:backdrop-blur cpk:supports-[backdrop-filter]:bg-background/80",
    "data-testid": "copilot-modal-header",
    "data-slot": "copilot-modal-header",
  },
  template: `
    <div class="cpk:flex cpk:w-full cpk:min-w-0 cpk:items-center cpk:gap-2">
      <div class="cpk:flex cpk:flex-1 cpk:justify-start">
        @if (showDrawerLauncher()) {
          <button
            type="button"
            [class]="iconButton"
            data-testid="copilot-threads-drawer-launcher"
            aria-label="Open threads"
            [attr.aria-expanded]="drawerOpen()"
            (click)="drawerToggle.emit()"
          >
            <copilot-icon [img]="History" [size]="16" />
          </button>
        }
      </div>
      <!-- A custom header gets a wider center column; equal side columns keep
           it centered either way. -->
      <div [class]="headerComponent() ? customTitleColumn : titleColumn">
        @if (headerComponent(); as header) {
          <ng-container [ngComponentOutlet]="header" />
        } @else {
          <h2
            class="cpk:m-0 cpk:w-full cpk:truncate cpk:text-sm cpk:font-semibold cpk:leading-none cpk:text-foreground"
            data-testid="copilot-header-title"
            [attr.id]="titleId()"
          >
            {{ title() }}
          </h2>
        }
      </div>
      <div class="cpk:flex cpk:flex-1 cpk:justify-end">
        <button
          type="button"
          [class]="iconButton"
          data-testid="copilot-close-button"
          aria-label="Close"
          (click)="closeClick.emit()"
        >
          <copilot-icon [img]="X" [size]="16" />
        </button>
      </div>
    </div>
  `,
})
export class CopilotModalHeader {
  readonly title = input.required<string>();
  readonly titleId = input.required<string>();
  readonly headerComponent = input<Type<unknown> | undefined>();
  readonly showDrawerLauncher = input(false);
  readonly drawerOpen = input(false);
  readonly closeClick = output<void>();
  readonly drawerToggle = output<void>();

  protected readonly History = History;
  protected readonly X = X;
  protected readonly iconButton = ICON_BUTTON;
  protected readonly titleColumn = TITLE_COLUMN;
  protected readonly customTitleColumn = TITLE_COLUMN.replace(
    "cpk:flex-1",
    "cpk:flex-[3]",
  );
}
