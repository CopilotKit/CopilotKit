import {
  Component,
  Directive,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  model,
  viewChildren,
} from "@angular/core";
import { FocusKeyManager } from "@angular/cdk/a11y";
import type { FocusableOption } from "@angular/cdk/a11y";
import {
  borderColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { GenerativeUIStyles } from "../../styles";
import { defined } from "../style";
import type { StyleMap } from "../style";

let nextTabsId = 0;

/** A tab button, as an item of the focus key manager. */
@Directive({ selector: "button[copilotGenerativeUITab]" })
export class CopilotGenerativeUITab implements FocusableOption {
  readonly #element = inject<ElementRef<HTMLButtonElement>>(ElementRef);
  focus() {
    this.#element.nativeElement.focus();
  }
}

/**
 * Tabs with one panel per tab: the `child` of each entry, rendered by the
 * engine. The tab list is one tab stop: the arrow keys, Home and End move
 * between the tabs and open them.
 */
@Component({
  selector: "div[copilotGenerativeUITabs]",
  imports: [CopilotGenerativeUIChildren, CopilotGenerativeUITab],
  template: `
    @if (count() > 0) {
      <div role="tablist" [style]="listStyle" (keydown)="onKeyDown($event)">
        @for (tab of tabs(); track $index; let i = $index) {
          <button
            copilotGenerativeUITab
            type="button"
            role="tab"
            data-a2ui-input
            [id]="id + '-tab-' + i"
            [attr.aria-selected]="i === selected()"
            [attr.aria-controls]="id + '-panel-' + i"
            [tabindex]="i === selected() ? 0 : -1"
            [style]="tabStyle(i === selected())"
            (click)="select(i)"
          >
            {{ tab.title }}
          </button>
        }
      </div>
      @for (tab of tabs(); track $index; let i = $index) {
        @if (i === selected()) {
          <div
            role="tabpanel"
            [id]="id + '-panel-' + i"
            [attr.aria-labelledby]="id + '-tab-' + i"
            [style]="panelStyle"
          >
            <ng-container *copilotGenerativeUIChildren="tab.child" />
          </div>
        }
      }
    }
  `,
  host: {
    "data-a2ui-std": "",
    "data-a2ui-tabs": "",
    "[style]": "hostStyle()",
  },
})
export class CopilotGenerativeUITabs {
  // The engine resolves each `child` id, so a tab carries children, not the id of the schema.
  readonly tabs = input<{ title: string; child: GenerativeUIChildren }[]>();
  readonly selectedIndex = model<number>();
  readonly weight = input<number>();

  protected readonly id = `a2ui-tabs-${nextTabsId++}`;
  protected readonly count = computed(() => this.tabs()?.length ?? 0);
  protected readonly selected = computed(() =>
    Math.min(
      Math.max(0, this.selectedIndex() ?? 0),
      Math.max(0, this.count() - 1),
    ),
  );
  protected readonly hostStyle = computed<StyleMap>(() =>
    defined({
      display: "flex",
      flexDirection: "column",
      gap: spacing(3),
      width: "100%",
      minWidth: 0,
      flexGrow: this.weight(),
    }),
  );
  protected readonly listStyle: StyleMap = {
    display: "flex",
    gap: spacing(1),
    borderBottom: `1px solid ${borderColor("default")}`,
    overflowX: "auto",
  };
  protected readonly panelStyle: StyleMap = {
    display: "flex",
    flexDirection: "column",
    gap: spacing(3),
  };

  protected readonly tabButtons = viewChildren(CopilotGenerativeUITab);
  readonly #manager = new FocusKeyManager(this.tabButtons, inject(Injector))
    .withHorizontalOrientation("ltr")
    .withWrap()
    .withHomeAndEnd();

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
    // A key moves the focus and opens the tab under it.
    this.#manager.change.subscribe((index) => {
      if (index !== this.selected()) this.select(index);
    });
    effect(() => this.#manager.updateActiveItem(this.selected()));
  }

  protected tabStyle(isSelected: boolean): StyleMap {
    return {
      flexShrink: 0,
      padding: `${spacing(2)} ${spacing(3)}`,
      marginBottom: "-1px",
      border: "none",
      borderBottom: `2px solid ${isSelected ? textColor("default") : "transparent"}`,
      background: "transparent",
      color: isSelected ? textColor("default") : textColor("secondary"),
      font: "inherit",
      fontWeight: 500,
      cursor: "pointer",
    };
  }

  protected select(index: number) {
    this.selectedIndex.set(index);
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (this.count() === 0) return;
    this.#manager.onKeydown(event);
  }
}
