import { Component, computed, input, signal } from "@angular/core";
import type { TabsApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-tabs",
  imports: [CopilotA2UIChild],
  template: `
    <div class="tabs">
      <div class="tab-list" role="tablist">
        @for (tab of tabs(); track $index) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.active]="selectedIndex() === $index"
            [attr.aria-selected]="selectedIndex() === $index"
            (click)="selectedIndex.set($index)"
          >
            {{ tab.title }}
          </button>
        }
      </div>
      <div class="tab-panel" role="tabpanel">
        @if (activeTab(); as tab) {
          <copilot-a2ui-child [child]="tab.child" />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .tabs {
      display: flex;
      flex-direction: column;
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
    }
    .tab-list {
      display: flex;
      margin-bottom: var(--a2ui-spacing-m, 8px);
      border-bottom: 1px solid var(--a2ui-color-border, #ccc);
    }
    .tab {
      padding: var(--a2ui-button-padding, 8px 16px);
      border: none;
      background: none;
      color: inherit;
      font-weight: normal;
      cursor: pointer;
    }
    .active {
      border-bottom: 2px solid
        var(--a2ui-color-primary, var(--a2ui-primary-color, #007bff));
      color: var(--a2ui-color-primary, var(--a2ui-primary-color, #007bff));
      font-weight: bold;
    }
    .tab-panel {
      flex: 1;
    }
  `,
})
export class CopilotA2UITabs {
  readonly props = input.required<BasicProps<typeof TabsApi>>();
  protected readonly selectedIndex = signal(0);
  protected readonly tabs = computed(() => this.props().tabs ?? []);
  protected readonly activeTab = computed(
    () => this.tabs()[this.selectedIndex()] ?? this.tabs()[0],
  );
}
