import { Component, computed, forwardRef, inject, input } from "@angular/core";
import { spacing } from "@copilotkit/shared/generative-ui";
import type {
  ListItemValue,
  ListMarker,
  ListSelection,
  listSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import { ALIGN_CSS } from "../style";
import type { StyleMap } from "../style";
import {
  CopilotGenerativeUIListItemBody,
  GENERATIVE_UI_LIST_CONTEXT,
  isNativeMarker,
} from "./list-item";
import type { GenerativeUIListContext } from "./list-item";

type ListProps = z.output<typeof listSchema>;

function itemEntry(item: ListItemValue) {
  return typeof item === "string" ? { label: item } : item;
}

/**
 * A list of items, or of ListItem children. The host is a `<ul>` also for
 * the "number" marker: a host cannot become an `<ol>`, so the numbers come
 * from the list style and `start` from the list-item counter.
 */
@Component({
  selector: "ul[copilotGenerativeUIList]",
  imports: [CopilotGenerativeUIChildren, CopilotGenerativeUIListItemBody],
  providers: [
    {
      provide: GENERATIVE_UI_LIST_CONTEXT,
      useExisting: forwardRef(() => CopilotGenerativeUIList),
    },
  ],
  template: `
    @if (entries().length > 0) {
      @for (entry of entries(); track $index) {
        <li>
          <copilot-generative-ui-list-item-body
            [label]="entry.label"
            [value]="entry.shownValue"
            [description]="entry.description"
            [icon]="entry.icon"
            [markerSize]="maxMarkerSize()"
            [hasConnector]="hasConnector()"
            [onPick]="entry.onPick"
          />
        </li>
      }
    } @else {
      <ng-container *copilotGenerativeUIChildren="children()" />
    }
  `,
  host: {
    class: "a2ui-std-list",
    "data-a2ui-std": "",
    "[attr.role]": "role()",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIList implements GenerativeUIListContext {
  readonly items = input<ListProps["items"]>();
  readonly direction = input<ListProps["direction"]>();
  readonly align = input<ListProps["align"]>();
  readonly weight = input<number>();
  readonly markerInput = input<ListMarker | undefined>(undefined, {
    alias: "marker",
  });
  readonly connector = input<ListProps["connector"]>();
  readonly gap = input<number | string>();
  readonly start = input<number>();
  readonly maxMarkerSize = input<number>();
  readonly action = input<GenerativeUIEventProp<ListSelection>>();
  readonly children = input<GenerativeUIChildren>();

  readonly marker = computed<ListMarker>(() => this.markerInput() ?? "bullet");
  readonly hasConnector = computed(() => this.connector() === "solid");

  /** Safari drops the list role when list-style is "none". */
  protected readonly role = computed(() =>
    isNativeMarker(this.marker()) && this.direction() !== "horizontal"
      ? null
      : "list",
  );
  protected readonly entries = computed(() => {
    const action = this.action();
    return (this.items() ?? []).map((item, index) => {
      const entry = itemEntry(item);
      const value = "value" in entry ? entry.value : undefined;
      return {
        label: entry.label,
        // With an action, the value is the payload of the pick.
        shownValue: action ? undefined : value,
        description: "description" in entry ? entry.description : undefined,
        icon: "icon" in entry ? entry.icon : undefined,
        onPick: action
          ? () =>
              void action({
                index,
                label: entry.label,
                value: value === undefined ? undefined : String(value),
              })
          : undefined,
      };
    });
  });
  protected readonly style = computed<StyleMap>(() => {
    const marker = this.marker();
    const isHorizontal = this.direction() === "horizontal";
    const listStyleType =
      marker === "number" ? "decimal" : marker === "bullet" ? "disc" : "none";
    const align = this.align();
    const start = this.start();
    return {
      margin: 0,
      paddingInlineStart: isNativeMarker(marker) && !isHorizontal ? "1.5em" : 0,
      listStyleType: isHorizontal ? "none" : listStyleType,
      counterReset:
        marker === "number" && start !== undefined
          ? `list-item ${start - 1}`
          : undefined,
      display: "flex",
      flexDirection: isHorizontal ? "row" : "column",
      alignItems: align ? ALIGN_CSS[align] : undefined,
      flexGrow: this.weight(),
      overflowX: isHorizontal ? "auto" : undefined,
      gap: spacing(this.gap() ?? (isHorizontal ? 3 : 1)),
    };
  });

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}
