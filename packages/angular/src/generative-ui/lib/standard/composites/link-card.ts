import { Component, computed, inject, input } from "@angular/core";
import {
  backgroundColor,
  borderColor,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import { hostOf } from "../media";
import type { StyleMap } from "../style";
import { safeHref } from "../text";
import {
  CLAMP_TWO,
  FAVICON_STYLE,
  SECONDARY_SM,
  SECONDARY_XS,
  TITLE_MD,
  faviconSrc,
} from "./styles";

const LINK_STYLE: StyleMap = {
  display: "flex",
  gap: spacing(3),
  "align-items": "flex-start",
  padding: spacing(3),
  border: `1px solid ${borderColor("default")}`,
  "border-radius": radius("xl"),
  background: backgroundColor("surface"),
  color: "inherit",
  "text-decoration": "none",
  width: "100%",
  "box-sizing": "border-box",
  cursor: "pointer",
  "text-align": "start",
};

/**
 * A preview card of a URL: an `<a>`, or a `<button>` when `onClick` is
 * bound, as in React. The node renderer creates the host from `hostTag`.
 */
@Component({
  selector: "[copilotGenerativeUILinkCard]",
  template: `
    <span
      style="display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1"
    >
      @if (shownDomain()) {
        <span
          [style]="domainStyle"
          style="display: flex; align-items: center; gap: 6px"
        >
          @if (favicon() !== false && host()) {
            <img
              [src]="faviconSrc(host()!)"
              alt=""
              width="16"
              height="16"
              [style]="faviconStyle"
            />
          }
          <span
            style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
            >{{ shownDomain() }}</span
          >
        </span>
      }
      <span [style]="titleStyle">{{ title() }}</span>
      @if (description()) {
        <span [style]="descriptionStyle">{{ description() }}</span>
      }
    </span>
    @if (image()) {
      <img [src]="image()" alt="" loading="lazy" [style]="imageStyle" />
    }
  `,
  host: {
    "data-a2ui-link-card": "",
    "[attr.data-a2ui-input]": "onClick() ? '' : null",
    "[attr.type]": "onClick() ? 'button' : null",
    "[attr.href]": "onClick() ? null : (safeHref() ?? null)",
    "[attr.target]": "onClick() ? null : '_blank'",
    "[attr.rel]": "onClick() ? null : 'noopener noreferrer'",
    "[style]": "onClick() ? buttonStyle : linkStyle",
    "(click)": "activate($event)",
  },
})
export class CopilotGenerativeUILinkCard {
  /** A link, or a button when a click handler is bound. */
  static hostTag(props: Record<string, unknown>) {
    return props.onClick ? "button" : "a";
  }

  readonly href = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly image = input<string>();
  readonly domain = input<string>();
  readonly favicon = input<boolean>();
  readonly onClick = input<GenerativeUIEventProp>();

  protected readonly safeHref = computed(() => safeHref(this.href()));
  protected readonly host = computed(() => {
    const href = this.safeHref();
    return href ? hostOf(href) : undefined;
  });
  protected readonly shownDomain = computed(
    () => this.domain() || this.host() || "",
  );
  protected readonly faviconSrc = faviconSrc;
  protected readonly faviconStyle = FAVICON_STYLE;
  protected readonly domainStyle = SECONDARY_XS;
  protected readonly titleStyle: StyleMap = { ...TITLE_MD, ...CLAMP_TWO };
  protected readonly descriptionStyle: StyleMap = {
    ...SECONDARY_SM,
    ...CLAMP_TWO,
  };
  protected readonly imageStyle: StyleMap = {
    width: "96px",
    height: "96px",
    "object-fit": "cover",
    "border-radius": radius("md"),
    flex: "none",
  };
  protected readonly linkStyle = LINK_STYLE;
  protected readonly buttonStyle: StyleMap = {
    ...LINK_STYLE,
    font: "inherit",
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected activate(event: Event) {
    const click = this.onClick();
    if (!click) return;
    event.stopPropagation();
    click({});
  }
}
