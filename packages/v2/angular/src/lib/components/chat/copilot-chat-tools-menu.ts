import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CdkMenuModule } from "@angular/cdk/menu";
import { OverlayModule } from "@angular/cdk/overlay";
import { LucideAngularModule, Settings2, ChevronRight } from "lucide-angular";
import type { ToolsMenuItem } from "./copilot-chat-input.types";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";

@Component({
  selector: "copilot-chat-tools-menu",
  standalone: true,
  imports: [CommonModule, CdkMenuModule, OverlayModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (hasItems()) {
      <button
        type="button"
        [disabled]="disabled()"
        [class]="buttonClass()"
        [cdkMenuTriggerFor]="menu"
      >
        <lucide-angular [img]="Settings2Icon" [size]="18"></lucide-angular>
        <span class="text-sm font-normal">{{ label }}</span>
      </button>

      <ng-template #menu>
        <div
          class="min-w-[200px] bg-white dark:bg-[#1F1F1F] border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1"
          cdkMenu
        >
          @for (item of toolsMenu(); track $index) {
            @if (item === "-") {
              <div class="h-px bg-gray-200 dark:bg-gray-700 my-1"></div>
            } @else if (isMenuItem(item)) {
              @if (item.items && item.items.length > 0) {
                <!-- Submenu trigger -->
                <button
                  type="button"
                  class="w-full px-3 py-2 text-left bg-transparent border-none rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm flex items-center justify-between"
                  [cdkMenuTriggerFor]="submenu"
                  cdkMenuItem
                >
                  {{ item.label }}
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    [size]="12"
                    class="ml-auto"
                  ></lucide-angular>
                </button>

                <!-- Submenu template -->
                <ng-template #submenu>
                  <div
                    class="min-w-[200px] bg-white dark:bg-[#1F1F1F] border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1"
                    cdkMenu
                  >
                    @for (subItem of item.items; track $index) {
                      @if (subItem === "-") {
                        <div
                          class="h-px bg-gray-200 dark:bg-gray-700 my-1"
                        ></div>
                      } @else if (isMenuItem(subItem)) {
                        <button
                          type="button"
                          class="w-full px-3 py-2 text-left bg-transparent border-none rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm"
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
                  class="w-full px-3 py-2 text-left bg-transparent border-none rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm"
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
    }
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
  readonly Settings2Icon = Settings2;
  readonly ChevronRightIcon = ChevronRight;
  inputToolsMenu = input<(ToolsMenuItem | "-")[] | undefined>();
  inputDisabled = input<boolean | undefined>();
  inputClass = input<string | undefined>();

  private labels = injectChatLabels();

  // Derive state from inputs
  toolsMenu = computed(() => this.inputToolsMenu() ?? []);
  disabled = computed(() => this.inputDisabled() ?? false);
  customClass = computed(() => this.inputClass());

  hasItems = computed(() => this.toolsMenu().length > 0);

  readonly label = this.labels.chatInputToolbarToolsButtonLabel;

  buttonClass = computed(() => {
    const baseClasses = cn(
      // Base button styles
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium",
      "transition-all disabled:pointer-events-none disabled:opacity-50",
      "shrink-0 outline-none",
      "focus-visible:ring-[3px]",
      // chatInputToolbarSecondary variant
      "cursor-pointer",
      "bg-transparent text-[#444444]",
      "dark:text-white dark:border-[#404040]",
      "transition-colors",
      "focus:outline-none",
      "hover:bg-[#f8f8f8] hover:text-[#333333]",
      "dark:hover:bg-[#404040] dark:hover:text-[#FFFFFF]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "disabled:hover:bg-transparent disabled:hover:text-[#444444]",
      "dark:disabled:hover:bg-transparent dark:disabled:hover:text-[#CCCCCC]",
      // Size
      "h-9 px-3 gap-2 font-normal"
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
