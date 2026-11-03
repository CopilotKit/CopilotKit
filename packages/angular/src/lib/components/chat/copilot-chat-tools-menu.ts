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
      <copilot-icon
        [img]="PlusIcon"
        iconClass="cpk-chat-input-add-menu-icon"
      ></copilot-icon>
    </button>

    <ng-template #menu>
      <div
        data-copilotkit
        class="cpk-dropdown-menu-content"
        data-state="open"
        cdkMenu
      >
        @for (item of menuItems(); track $index) {
          @if (item === "-") {
            <div class="cpk-dropdown-menu-separator"></div>
          } @else if (isMenuItem(item)) {
            @if (item.items && item.items.length > 0) {
              <!-- Submenu trigger -->
              <button
                type="button"
                class="cpk-dropdown-menu-sub-trigger"
                [cdkMenuTriggerFor]="submenu"
                cdkMenuItem
              >
                {{ item.label }}
                <copilot-icon
                  [img]="ChevronRightIcon"
                  iconClass="cpk-dropdown-menu-sub-trigger-icon"
                ></copilot-icon>
              </button>

              <!-- Submenu template -->
              <ng-template #submenu>
                <div
                  data-copilotkit
                  class="cpk-dropdown-menu-sub-content"
                  data-state="open"
                  cdkMenu
                >
                  @for (subItem of item.items; track $index) {
                    @if (subItem === "-") {
                      <div class="cpk-dropdown-menu-separator"></div>
                    } @else if (isMenuItem(subItem)) {
                      <button
                        type="button"
                        class="cpk-dropdown-menu-item"
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
                class="cpk-dropdown-menu-item"
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

  buttonClass = computed(() =>
    cn(
      "cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-add-menu-button",
      this.customClass(),
    ),
  );

  isMenuItem(item: any): item is ToolsMenuItem {
    return item && typeof item === "object" && "label" in item;
  }

  handleItemClick(item: ToolsMenuItem): void {
    if (item.action) {
      item.action();
    }
  }
}
