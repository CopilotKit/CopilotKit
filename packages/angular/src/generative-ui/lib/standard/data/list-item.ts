import {
  Component,
  InjectionToken,
  computed,
  inject,
  input,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import {
  FONT_WEIGHT,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { ListMarker } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import type { GenerativeUIEventProp } from "../context";
import { CopilotGenerativeUIIcon } from "../media";
import type { StyleMap } from "../style";

/** What a List tells the items in it. */
export interface GenerativeUIListContext {
  marker: Signal<ListMarker>;
  hasConnector: Signal<boolean>;
  maxMarkerSize: Signal<number | undefined>;
}

export const GENERATIVE_UI_LIST_CONTEXT =
  new InjectionToken<GenerativeUIListContext>("GENERATIVE_UI_LIST_CONTEXT");

export const isNativeMarker = (marker: string | undefined) =>
  marker === "bullet" || marker === "number";

/** A plain button: no box, the full row is the hit area, a focus ring. */
const ITEM_BUTTON_STYLE: StyleMap = {
  display: "block",
  width: "100%",
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  textAlign: "start",
  cursor: "pointer",
  boxSizing: "border-box",
  borderRadius: radius("xs"),
};

/**
 * @internal
 * The body of a List item or a ListItem: the marker or icon, the label and
 * the value, the description and the children. With `onPick`, the whole
 * row is a button.
 */
@Component({
  selector: "copilot-generative-ui-list-item-body",
  imports: [CopilotGenerativeUIIcon, NgTemplateOutlet],
  template: `
    @if (onPick(); as pick) {
      <button
        type="button"
        data-a2ui-input
        (click)="$event.stopPropagation(); pick()"
        [style]="buttonStyle"
      >
        <ng-container *ngTemplateOutlet="row" />
      </button>
    } @else {
      <ng-container *ngTemplateOutlet="row" />
    }
    <ng-template #row>
      <span [style]="rowStyle()">
        @if (hasLeading()) {
          <span aria-hidden="true" [style]="leadingStyle()">
            @if (icon(); as icon) {
              <svg copilotGenerativeUIIcon [name]="icon" size="sm"></svg>
            } @else {
              {{ marker() }}
            }
          </span>
        }
        <span style="display: flex; flex-direction: column; min-width: 0; flex: 1">
          @if (label() || value() !== undefined) {
            <span [style]="titleStyle">
              <span>{{ label() }}</span>
              @if (value() !== undefined) {
                <span data-a2ui-list-value [style]="valueStyle">{{ value() }}</span>
              }
            </span>
          }
          @if (description(); as description) {
            <span [style]="descriptionStyle">{{ description }}</span>
          }
          <ng-content />
        </span>
      </span>
    </ng-template>
  `,
  host: { style: "display: contents" },
})
export class CopilotGenerativeUIListItemBody {
  readonly label = input<string>();
  readonly value = input<string | number>();
  readonly description = input<string>();
  readonly icon = input<string>();
  readonly marker = input<string>();
  readonly markerSize = input<number>();
  readonly hasConnector = input<boolean>();
  readonly onPick = input<(() => void) | undefined>();

  protected readonly buttonStyle = ITEM_BUTTON_STYLE;
  protected readonly titleStyle: StyleMap = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing(3),
    ...textFont("md"),
    color: textColor("default"),
  };
  protected readonly valueStyle: StyleMap = {
    fontWeight: FONT_WEIGHT.medium,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    flex: "none",
  };
  protected readonly descriptionStyle: StyleMap = {
    ...textFont("sm"),
    color: textColor("secondary"),
  };
  protected readonly hasLeading = computed(() => {
    const marker = this.marker();
    return (
      this.icon() !== undefined ||
      (marker !== undefined && !isNativeMarker(marker))
    );
  });
  protected readonly leadingStyle = computed<StyleMap>(() => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: `${this.markerSize() ?? 20}px`,
    maxWidth:
      this.markerSize() === undefined ? undefined : `${this.markerSize()}px`,
    paddingTop: "2px",
    color: textColor("secondary"),
  }));
  protected readonly rowStyle = computed<StyleMap>(() => ({
    display: this.hasLeading() ? "flex" : "block",
    gap: spacing(2),
    alignItems: "flex-start",
    borderInlineStart: this.hasConnector()
      ? `2px solid ${borderColor("default")}`
      : undefined,
    paddingInlineStart: this.hasConnector() ? spacing(3) : undefined,
  }));
}

/** An item of a List. The host is the `<li>`. */
@Component({
  selector: "li[copilotGenerativeUIListItem]",
  imports: [CopilotGenerativeUIChildren, CopilotGenerativeUIListItemBody],
  template: `
    <copilot-generative-ui-list-item-body
      [label]="label()"
      [value]="pick() ? undefined : value()"
      [description]="description()"
      [icon]="icon()"
      [marker]="marker()"
      [markerSize]="markerSize() ?? list?.maxMarkerSize()"
      [hasConnector]="list?.hasConnector()"
      [onPick]="pick()"
    >
      <ng-container *copilotGenerativeUIChildren="children()" />
    </copilot-generative-ui-list-item-body>
  `,
  host: {
    "[attr.aria-disabled]": "disabled() === true ? 'true' : null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIListItem {
  readonly label = input<string>();
  readonly value = input<string | number>();
  readonly description = input<string>();
  readonly icon = input<string>();
  readonly marker = input<string>();
  readonly markerSize = input<number>();
  readonly disabled = input<boolean>();
  readonly action = input<GenerativeUIEventProp>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly list = inject(GENERATIVE_UI_LIST_CONTEXT, {
    optional: true,
  });

  protected readonly pick = computed(() => {
    const action = this.disabled() === true ? undefined : this.action();
    return action ? () => void action({}) : undefined;
  });
  protected readonly style = computed<StyleMap>(() => {
    // An own marker replaces the native bullet or number.
    const hidesNativeMarker =
      this.marker() !== undefined && isNativeMarker(this.list?.marker());
    return {
      listStyleType: hidesNativeMarker ? "none" : undefined,
      opacity: this.disabled() === true ? 0.5 : undefined,
    };
  });
}
