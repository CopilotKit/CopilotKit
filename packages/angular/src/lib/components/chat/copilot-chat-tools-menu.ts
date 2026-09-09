import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { CdkMenuModule } from "@angular/cdk/menu";
import { OverlayModule } from "@angular/cdk/overlay";
import { ChevronRight, CopilotIcon, Plus } from "../icons/copilot-icon";
import type { ToolsMenuItem } from "./copilot-chat-input.types";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";
import { CopilotTooltip } from "../../directives/tooltip";

@Component({
  selector: "copilot-chat-tools-menu",
  imports: [CdkMenuModule, OverlayModule, CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [attr.aria-label]="tooltipLabel()"
      [disabled]="triggerDisabled()"
      [class]="buttonClass()"
      [cdkMenuTriggerFor]="menu"
      [copilotTooltip]="tooltipLabel()"
      tooltipPosition="below"
    >
      <copilot-icon [img]="PlusIcon" [size]="20"></copilot-icon>
    </button>

    <ng-template #menu>
      <div
        data-copilotkit
        class="cpk:bg-popover cpk:text-popover-foreground cpk:z-50 cpk:max-h-[var(--radix-dropdown-menu-content-available-height)] cpk:min-w-[8rem] cpk:overflow-x-hidden cpk:overflow-y-auto cpk:rounded-md cpk:border cpk:p-1 cpk:shadow-md"
        cdkMenu
      >
        @for (item of menuItems(); track $index) {
          @if (item === "-") {
            <div class="cpk:-mx-1 cpk:my-1 cpk:h-px cpk:bg-border"></div>
          } @else if (isMenuItem(item)) {
            @if (item.items && item.items.length > 0) {
              <!-- Submenu trigger -->
              <button
                type="button"
                class="cpk:relative cpk:flex cpk:w-full cpk:cursor-default cpk:select-none cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:border-none cpk:bg-transparent cpk:px-2 cpk:py-1.5 cpk:text-left cpk:text-sm cpk:outline-hidden cpk:hover:bg-accent cpk:hover:text-accent-foreground cpk:focus:bg-accent cpk:focus:text-accent-foreground"
                [cdkMenuTriggerFor]="submenu"
                cdkMenuItem
              >
                {{ item.label }}
                <copilot-icon
                  [img]="ChevronRightIcon"
                  [size]="12"
                  class="cpk:ml-auto"
                ></copilot-icon>
              </button>

              <!-- Submenu template -->
              <ng-template #submenu>
                <div
                  data-copilotkit
                  class="cpk:bg-popover cpk:text-popover-foreground cpk:z-50 cpk:max-h-[var(--radix-dropdown-menu-content-available-height)] cpk:min-w-[8rem] cpk:overflow-x-hidden cpk:overflow-y-auto cpk:rounded-md cpk:border cpk:p-1 cpk:shadow-md"
                  cdkMenu
                >
                  @for (subItem of item.items; track $index) {
                    @if (subItem === "-") {
                      <div class="cpk:-mx-1 cpk:my-1 cpk:h-px cpk:bg-border"></div>
                    } @else if (isMenuItem(subItem)) {
                      <button
                        type="button"
                        class="cpk:relative cpk:flex cpk:w-full cpk:cursor-default cpk:select-none cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:border-none cpk:bg-transparent cpk:px-2 cpk:py-1.5 cpk:text-left cpk:text-sm cpk:outline-hidden cpk:hover:bg-accent cpk:hover:text-accent-foreground cpk:focus:bg-accent cpk:focus:text-accent-foreground"
                        (click)="handleItemClick(subItem)"
                        cdkMenuItem
                      >
                        {{ subItem.label }}
                      </button>
                    }
                  }
                </div>
              </ng-template>
            } @else {
              <!-- Regular menu item -->
              <button
                type="button"
                class="cpk:relative cpk:flex cpk:w-full cpk:cursor-default cpk:select-none cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:border-none cpk:bg-transparent cpk:px-2 cpk:py-1.5 cpk:text-left cpk:text-sm cpk:outline-hidden cpk:hover:bg-accent cpk:hover:text-accent-foreground cpk:focus:bg-accent cpk:focus:text-accent-foreground"
                (click)="handleItemClick(item)"
                cdkMenuItem
              >
                {{ item.label }}
              </button>
            }
          }
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      /* CDK Overlay styles for positioning */
      .cdk-overlay-pane {
        position: absolute;
        pointer-events: auto;
        z-index: 1000;
      }

      /* Ensure menu appears above other content */
      .cdk-overlay-container {
        position: fixed;
        z-index: 1000;
      }

      /* Menu animation */
      [cdkMenu] {
        animation: menuFadeIn 0.15s ease-out;
      }

      @keyframes menuFadeIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class CopilotChatToolsMenu {
  readonly PlusIcon = Plus;
  readonly ChevronRightIcon = ChevronRight;
  inputToolsMenu = input<(ToolsMenuItem | "-")[] | undefined>();
  inputDisabled = input<boolean | undefined>();
  inputClass = input<string | undefined>();
  inputAddFile = input<(() => void) | undefined>();

  private labels = injectChatLabels();

  // Derive state from inputs
  toolsMenu = computed(() => this.inputToolsMenu() ?? []);
  disabled = computed(() => this.inputDisabled() ?? false);
  customClass = computed(() => this.inputClass());
  addFile = computed(() => this.inputAddFile());

  menuItems = computed<(ToolsMenuItem | "-")[]>(() => {
    const items: (ToolsMenuItem | "-")[] = [];
    const addFile = this.addFile();

    if (addFile) {
      items.push({
        label: this.labels.chatInputToolbarAddButtonLabel,
        action: addFile,
      });
    }

    for (const item of this.toolsMenu()) {
      if (item === "-") {
        if (items.length === 0 || items[items.length - 1] === "-") {
          continue;
        }
        items.push(item);
      } else {
        items.push(item);
      }
    }

    while (items.length > 0 && items[items.length - 1] === "-") {
      items.pop();
    }

    return items;
  });

  hasItems = computed(() => this.menuItems().length > 0);
  triggerDisabled = computed(() => this.disabled() || !this.hasItems());

  readonly label = this.labels.chatInputToolbarToolsButtonLabel;

  tooltipLabel = computed(() =>
    this.addFile()
      ? this.labels.chatInputToolbarAddButtonLabel
      : this.labels.chatInputToolbarToolsButtonLabel,
  );

  buttonClass = computed(() => {
    const baseClasses = cn(
      // Base button styles
      "cpk:inline-flex cpk:items-center cpk:justify-center cpk:gap-2 cpk:whitespace-nowrap cpk:rounded-full cpk:text-sm cpk:font-medium",
      "cpk:transition-all cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
      "cpk:shrink-0 cpk:outline-none",
      "cpk:focus-visible:ring-[3px]",
      // chatInputToolbarSecondary variant
      "cpk:cursor-pointer",
      "cpk:bg-transparent cpk:text-[#444444]",
      "cpk:dark:text-white cpk:dark:border-[#404040]",
      "cpk:transition-colors",
      "cpk:focus:outline-none",
      "cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333]",
      "cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]",
      "cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50",
      "cpk:disabled:hover:bg-transparent cpk:disabled:hover:text-[#444444]",
      "cpk:dark:disabled:hover:bg-transparent cpk:dark:disabled:hover:text-[#CCCCCC]",
      // Size
      "cpk:h-9 cpk:w-9",
    );
    return cn(baseClasses, this.customClass());
  });

  isMenuItem(item: any): item is ToolsMenuItem {
    return item && typeof item === "object" && "label" in item;
  }

  handleItemClick(item: ToolsMenuItem): void {
    if (item.action) {
      item.action();
    }
  }
}
