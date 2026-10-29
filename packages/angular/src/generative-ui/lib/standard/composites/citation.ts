import {
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  FONT_WEIGHT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import { GenerativeUIStyles } from "../../styles";
import { hostOf } from "../media";
import type { StyleMap } from "../style";
import { safeHref } from "../text";
import {
  FAVICON_STYLE,
  SECONDARY_SM,
  SECONDARY_XS,
  faviconSrc,
} from "./styles";

/**
 * An inline source marker that shows the source on hover or click. The
 * panel sits in the flow, positioned against the marker, as in React.
 */
@Component({
  selector: "span[copilotGenerativeUICitation]",
  template: `
    <button
      type="button"
      [attr.aria-expanded]="isOpen()"
      [attr.aria-label]="'Source ' + marker()"
      data-a2ui-input=""
      (click)="$event.stopPropagation(); isOpen.set(!isOpen())"
      [style]="markerStyle"
    >
      {{ marker() }}
    </button>
    @if (isOpen()) {
      <span role="dialog" [style]="panelStyle">
        @if (shownSource()) {
          <span
            [style]="sourceStyle"
            style="display: flex; align-items: center; gap: 6px"
          >
            @if (host()) {
              <img
                [src]="faviconSrc(host()!)"
                alt=""
                width="16"
                height="16"
                [style]="faviconStyle"
              />
            }
            {{ shownSource() }}
          </span>
        }
        @if (title()) {
          <span [style]="titleStyle">{{ title() }}</span>
        }
        @if (snippet()) {
          <span [style]="snippetStyle">{{ snippet() }}</span>
        }
        @if (safeUrl()) {
          <a
            [attr.href]="safeUrl()"
            target="_blank"
            rel="noopener noreferrer"
            [style]="openStyle"
            >Open source</a
          >
        }
      </span>
    }
  `,
  host: {
    "data-a2ui-citation": "",
    style: "position:relative;display:inline-flex;vertical-align:baseline",
    "(mouseenter)": "isOpen.set(true)",
    "(mouseleave)": "isOpen.set(false)",
  },
})
export class CopilotGenerativeUICitation {
  readonly index = input<number>();
  readonly label = input<string>();
  readonly title = input<string>();
  readonly url = input<string>();
  readonly snippet = input<string>();
  readonly source = input<string>();

  protected readonly isOpen = signal(false);
  protected readonly safeUrl = computed(() => {
    const url = this.url();
    return url ? safeHref(url) : undefined;
  });
  protected readonly host = computed(() => {
    const url = this.safeUrl();
    return url ? hostOf(url) : undefined;
  });
  protected readonly shownSource = computed(
    () => this.source() || this.host() || "",
  );
  protected readonly marker = computed(
    () => this.label() || String(this.index() ?? 1),
  );
  protected readonly faviconSrc = faviconSrc;
  protected readonly faviconStyle = FAVICON_STYLE;
  protected readonly markerStyle: StyleMap = {
    font: "inherit",
    "font-size": ".75em",
    "line-height": 1,
    "font-weight": FONT_WEIGHT.medium,
    padding: "2px 6px",
    margin: "0 2px",
    "border-radius": "9999px",
    border: "none",
    background: backgroundColor("surface-secondary"),
    color: textColor("secondary"),
    cursor: "pointer",
    "vertical-align": "super",
  };
  protected readonly panelStyle: StyleMap = {
    position: "absolute",
    top: "100%",
    left: 0,
    "z-index": 50,
    "margin-top": "6px",
    width: "280px",
    display: "flex",
    "flex-direction": "column",
    gap: "4px",
    padding: spacing(3),
    background: backgroundColor("surface-elevated"),
    border: `1px solid ${borderColor("default")}`,
    "border-radius": radius("lg"),
    "box-shadow": SHADOW_MD,
    "text-align": "start",
  };
  protected readonly sourceStyle = SECONDARY_XS;
  protected readonly titleStyle: StyleMap = {
    ...textFont("sm"),
    "font-weight": FONT_WEIGHT.medium,
    color: textColor("default"),
  };
  protected readonly snippetStyle = SECONDARY_SM;
  protected readonly openStyle: StyleMap = {
    ...textFont("xs"),
    color: textColor("info"),
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    effect((onCleanup) => {
      if (!this.isOpen() || !isBrowser) return;
      const onDown = (event: Event) => {
        if (event.target instanceof Node && !element.contains(event.target)) {
          this.isOpen.set(false);
        }
      };
      document.addEventListener("mousedown", onDown);
      onCleanup(() => document.removeEventListener("mousedown", onDown));
    });
  }
}
