import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
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
 * `CopilotModalHeader`: optional threads launcher on the left, centered title,
 * close button on the right. A custom `headerComponent` takes the whole row
 * between the launcher and the close button.
 */
@Component({
  selector: "header[copilotModalHeader]",
  imports: [NgComponentOutlet, NgTemplateOutlet, CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      "copilotKitHeader cpk:flex cpk:h-14 cpk:shrink-0 cpk:items-center cpk:justify-between cpk:border-b cpk:border-border cpk:px-3 cpk:bg-background/95 cpk:backdrop-blur cpk:supports-[backdrop-filter]:bg-background/80",
    "data-testid": "copilot-modal-header",
    "data-slot": "copilot-modal-header",
  },
  template: `
    <ng-template #drawerLauncher>
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
    </ng-template>
    <ng-template #closeButton>
      <button
        type="button"
        cdkFocusInitial
        [class]="iconButton"
        data-testid="copilot-close-button"
        [attr.aria-label]="closeLabel()"
        (click)="closeClick.emit()"
      >
        <copilot-icon [img]="X" [size]="16" />
      </button>
    </ng-template>

    <div class="cpk:flex cpk:w-full cpk:min-w-0 cpk:items-center cpk:gap-2">
      @if (headerComponent(); as header) {
        <!-- A custom header fills the row between launcher and close button. -->
        @if (showDrawerLauncher()) {
          <ng-container [ngTemplateOutlet]="drawerLauncher" />
        }
        <div class="cpk:min-w-0 cpk:flex-1">
          <ng-container [ngComponentOutlet]="header" />
        </div>
        <ng-container [ngTemplateOutlet]="closeButton" />
      } @else {
        <!-- Equal side columns keep the title centered. -->
        <div class="cpk:flex cpk:flex-1 cpk:justify-start">
          @if (showDrawerLauncher()) {
            <ng-container [ngTemplateOutlet]="drawerLauncher" />
          }
        </div>
        <div [class]="titleColumn">
          <h2
            class="cpk:m-0 cpk:w-full cpk:truncate cpk:text-sm cpk:font-semibold cpk:leading-none cpk:text-foreground"
            data-testid="copilot-header-title"
            [attr.id]="titleId()"
          >
            {{ title() }}
          </h2>
        </div>
        <div class="cpk:flex cpk:flex-1 cpk:justify-end">
          <ng-container [ngTemplateOutlet]="closeButton" />
        </div>
      }
    </div>
  `,
})
export class CopilotModalHeader {
  readonly title = input.required<string>();
  readonly titleId = input.required<string>();
  readonly headerComponent = input<Type<unknown> | undefined>();
  readonly showDrawerLauncher = input(false);
  readonly drawerOpen = input(false);
  /** Accessible name of the close button. */
  readonly closeLabel = input("Close");
  readonly closeClick = output<void>();
  readonly drawerToggle = output<void>();

  protected readonly History = History;
  protected readonly X = X;
  protected readonly iconButton = ICON_BUTTON;
  protected readonly titleColumn = TITLE_COLUMN;
}
