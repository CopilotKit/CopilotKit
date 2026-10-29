import { Component, computed, inject, input } from "@angular/core";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  cardAction,
  entityCardSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import { openUrl } from "../lightbox";
import type { StyleMap } from "../style";
import { safeHref } from "../text";
import { PILL_BUTTON, SECONDARY_SM, SECONDARY_XS, TITLE_MD } from "./styles";

type EntityCardProps = z.output<typeof entityCardSchema>;
type CardActionItem = z.output<typeof cardAction>;

/** A card for one thing: an image, title, meta, badge, rating and buttons. */
@Component({
  selector: "div[copilotGenerativeUIEntityCard]",
  template: `
    @if (image()) {
      <img [src]="image()" [alt]="title()" loading="lazy" [style]="imageStyle()" />
    }
    <div [style]="bodyStyle">
      @if (badge()?.label || subtitle()) {
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
          @if (subtitle()) {
            <span [style]="subtitleStyle">{{ subtitle() }}</span>
          }
          @if (badge()?.label) {
            <span [style]="badgeStyle()">{{ badge()!.label }}</span>
          }
        </div>
      }
      <span [style]="titleStyle">{{ title() }}</span>
      @if (rating() !== undefined) {
        <span
          [attr.aria-label]="stars().clamped + ' out of 5'"
          [style]="starsStyle"
        >
          <span
            aria-hidden="true"
            style="color: var(--a2ui-color-rating, #f5a524); letter-spacing: 1px"
            >{{ stars().filled
            }}<span [style.color]="emptyStarColor">{{ stars().empty }}</span></span
          >
          <span>{{ stars().clamped.toFixed(1) }}</span>
          @if (ratingCount() !== undefined) {
            <span>({{ ratingCount() }})</span>
          }
        </span>
      }
      @if (description()) {
        <span [style]="descriptionStyle">{{ description() }}</span>
      }
      @if (meta()) {
        <span [style]="metaStyle">{{ meta() }}</span>
      }
      @if (shownActions().length > 0) {
        <div [style]="actionsStyle">
          @for (action of shownActions(); track $index) {
            <button
              type="button"
              data-a2ui-input=""
              (click)="$event.stopPropagation(); onActionClick(action)"
              [style]="actionStyle(action)"
            >
              {{ action.label }}
            </button>
          }
        </div>
      }
    </div>
  `,
  host: {
    "data-a2ui-entity-card": "",
    "data-a2ui-std": "",
    "[attr.role]": "isClickable() ? 'link' : null",
    "[attr.tabindex]": "isClickable() ? 0 : null",
    "[style]": "style()",
    "(click)": "onClickHost($event)",
    "(keydown)": "onKeyDown($event)",
  },
})
export class CopilotGenerativeUIEntityCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly description = input<string>();
  readonly image = input<string>();
  readonly imageAspectRatio = input<string>();
  readonly meta = input<string>();
  readonly badge = input<EntityCardProps["badge"]>();
  readonly rating = input<number>();
  readonly ratingCount = input<number>();
  readonly href = input<string>();
  readonly actions = input<CardActionItem[]>();
  readonly layout = input<EntityCardProps["layout"]>();
  readonly width = input<number | string>();
  readonly onClick = input<GenerativeUIEventProp>();
  readonly onAction = input<GenerativeUIEventProp<{ label: string }>>();

  protected readonly isHorizontal = computed(
    () => this.layout() === "horizontal",
  );
  protected readonly safeUrl = computed(() => {
    const href = this.href();
    return href ? safeHref(href) : undefined;
  });
  protected readonly isClickable = computed(
    () => this.safeUrl() !== undefined || this.onClick() !== undefined,
  );
  protected readonly shownActions = computed(() =>
    (this.actions() ?? []).slice(0, 3),
  );
  protected readonly stars = computed(() => {
    const clamped = Math.max(0, Math.min(5, this.rating() ?? 0));
    const filled = Math.round(clamped);
    return {
      clamped,
      filled: "★".repeat(filled),
      empty: "★".repeat(5 - filled),
    };
  });
  protected readonly emptyStarColor = borderColor("strong");

  protected readonly style = computed<StyleMap>(() => {
    const isHorizontal = this.isHorizontal();
    return {
      display: "flex",
      "flex-direction": isHorizontal ? "row" : "column",
      gap: isHorizontal ? spacing(3) : 0,
      width: spacing(this.width()) ?? "100%",
      "max-width": "100%",
      "min-width": 0,
      "box-sizing": "border-box",
      border: `1px solid ${borderColor("default")}`,
      "border-radius": radius("xl"),
      background: backgroundColor("surface"),
      overflow: "hidden",
      // A horizontal card keeps its content height inside a stretched grid
      // row. The vertical card may fill the row.
      "align-self": isHorizontal ? "start" : undefined,
      cursor: this.isClickable() ? "pointer" : undefined,
    };
  });
  protected readonly imageStyle = computed<StyleMap>(() => {
    const isHorizontal = this.isHorizontal();
    return {
      display: "block",
      "object-fit": "cover",
      width: isHorizontal ? "120px" : "100%",
      "aspect-ratio": isHorizontal
        ? "1 / 1"
        : (this.imageAspectRatio() ?? "4 / 3"),
      "align-self": isHorizontal ? "start" : undefined,
      flex: "none",
    };
  });
  protected readonly bodyStyle: StyleMap = {
    display: "flex",
    "flex-direction": "column",
    gap: "4px",
    padding: spacing(3),
    "min-width": 0,
    flex: 1,
  };
  protected readonly subtitleStyle: StyleMap = {
    ...SECONDARY_XS,
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  };
  protected readonly badgeStyle = computed<StyleMap>(() => {
    const color = this.badge()?.color;
    return {
      ...textFont("xs"),
      "font-weight": FONT_WEIGHT.medium,
      padding: "1px 8px",
      "border-radius": "9999px",
      background: backgroundColor(color ?? "surface-secondary"),
      color: textColor(color ?? "default"),
      flex: "none",
    };
  });
  protected readonly titleStyle = TITLE_MD;
  protected readonly starsStyle: StyleMap = {
    display: "inline-flex",
    "align-items": "center",
    gap: "4px",
    ...SECONDARY_SM,
  };
  protected readonly descriptionStyle: StyleMap = {
    ...SECONDARY_SM,
    display: "-webkit-box",
    "-webkit-line-clamp": 3,
    "-webkit-box-orient": "vertical",
    overflow: "hidden",
  };
  protected readonly metaStyle: StyleMap = {
    ...textFont("sm"),
    "font-weight": FONT_WEIGHT.medium,
    color: textColor("default"),
    "margin-top": "2px",
  };
  protected readonly actionsStyle: StyleMap = {
    display: "flex",
    "flex-wrap": "wrap",
    gap: spacing(2),
    "margin-top": spacing(2),
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected actionStyle(item: CardActionItem): StyleMap {
    const variant =
      item.variant ?? (item.href || this.onAction() ? "outline" : "ghost");
    const isSolid = variant === "solid";
    return {
      ...PILL_BUTTON,
      border:
        variant === "outline"
          ? `1px solid ${borderColor("default")}`
          : "1px solid transparent",
      background: isSolid
        ? ACCENT
        : variant === "soft"
          ? backgroundColor("surface-secondary")
          : "transparent",
      color: isSolid ? ON_ACCENT : textColor("default"),
    };
  }

  protected onActionClick(item: CardActionItem) {
    if (item.href) openUrl(item.href);
    else this.onAction()?.({ label: item.label });
  }

  protected onClickHost(event: Event) {
    if (!this.isClickable()) return;
    event.stopPropagation();
    const onClick = this.onClick();
    if (onClick) onClick({});
    else openUrl(this.safeUrl());
  }

  protected onKeyDown(event: KeyboardEvent) {
    const isOwnKey = event.target === event.currentTarget;
    if (
      this.isClickable() &&
      isOwnKey &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      this.onClickHost(event);
    }
  }
}
