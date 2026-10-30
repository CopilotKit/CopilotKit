import { Component, computed, inject, input, signal } from "@angular/core";
import { controlAria } from "@copilotkit/core/generative-ui";
import type { GenerativeUIAriaAttributes } from "@copilotkit/core/generative-ui";
import {
  ON_ACCENT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  IMAGE_VARIANTS,
  imageSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { injectGenerativeUIAccessibility } from "../../node-context";
import type { GenerativeUIEventProp } from "../context";
import { GenerativeUILightbox } from "../lightbox";
import { radiusStyle } from "../style";
import type { StyleMap } from "../style";
import { faviconSrc, hostOf, openUrl } from "../url";
import { CopilotGenerativeUIIcon } from "./icon";

type ImageVariantStyle = Partial<
  Record<
    "width" | "height" | "maxWidth" | "aspectRatio" | "borderRadius",
    string | number | undefined
  >
>;

/** The size of each Image variant. "mediumFeature" is the natural size. */
const IMAGE_VARIANT_STYLE: Record<
  (typeof IMAGE_VARIANTS)[number],
  ImageVariantStyle
> = {
  icon: { width: "24px", height: "24px", borderRadius: radius("xs") },
  avatar: { width: "40px", height: "40px", borderRadius: radius("full") },
  smallFeature: { width: "100%", maxWidth: "160px" },
  mediumFeature: {},
  largeFeature: { width: "100%" },
  header: { width: "100%", aspectRatio: "3 / 1" },
};

const OBJECT_FIT = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  none: "none",
  scaleDown: "scale-down",
} as const;

type ImageProps = z.output<typeof imageSchema>;

/**
 * An image from a URL. The host is `display: contents` around the `<img>`,
 * so the image lays out alone; with an action overlay or hover zoom the
 * host is the wrapper, and after a failed load with `fallback` the host is
 * the fallback box itself.
 */
@Component({
  selector: "div[copilotGenerativeUIImage]",
  imports: [CopilotGenerativeUIIcon],
  template: `
    @if (mode() === "fallback") {
      {{ fallback() }}
    } @else if (mode() !== "hidden") {
      <img
        [src]="url()"
        [alt]="alt()"
        [attr.aria-label]="imageAria()['aria-label'] ?? null"
        [attr.aria-description]="imageAria()['aria-description'] ?? null"
        [attr.aria-hidden]="imageAria()['aria-hidden'] ? 'true' : null"
        [attr.aria-live]="imageAria()['aria-live'] ?? null"
        loading="lazy"
        (error)="onError($event)"
        (click)="open()"
        [attr.data-a2ui-lightbox-trigger]="showsLightbox() ? '' : null"
        [style]="imageStyle()"
      />
      @if (actionOverlay(); as overlay) {
        <button
          type="button"
          data-a2ui-input
          (click)="onOverlay($event, overlay)"
          [style]="overlayStyle"
        >
          @if (overlay.icon) {
            <span aria-hidden="true" style="display: flex">
              <svg copilotGenerativeUIIcon [name]="overlay.icon" [size]="14"></svg>
            </span>
          }
          {{ overlay.label }}
        </button>
      }
    }
  `,
  host: {
    "[attr.role]": "mode() === 'fallback' ? 'img' : null",
    "[attr.aria-label]":
      "mode() === 'fallback' ? (aria()['aria-label'] ?? (alt() || fallback())) : null",
    "[attr.aria-description]":
      "mode() === 'fallback' ? (aria()['aria-description'] ?? null) : null",
    "[style]": "hostStyle()",
    "(mouseenter)": "hovered.set(true)",
    "(mouseleave)": "hovered.set(false)",
  },
})
export class CopilotGenerativeUIImage {
  readonly url = input<string>();
  readonly description = input<string>();
  readonly variant = input<ImageProps["variant"]>();
  readonly weight = input<number>();
  readonly aspectRatio = input<string>();
  readonly fit = input<ImageProps["fit"]>();
  readonly radius = input<ImageProps["radius"]>();
  readonly width = input<number | string>();
  readonly height = input<number | string>();
  readonly maxWidth = input<number | string>();
  readonly maxHeight = input<number | string>();
  readonly minWidth = input<number | string>();
  readonly minHeight = input<number | string>();
  readonly background = input<string>();
  readonly frame = input<boolean>();
  readonly position = input<string>();
  readonly hideOnFailure = input<boolean>();
  readonly fallback = input<string>();
  readonly hoverZoom = input<boolean>();
  readonly lightbox = input<boolean>();
  readonly actionOverlay = input<ImageProps["actionOverlay"]>();
  readonly onOverlayClick = input<GenerativeUIEventProp>();

  protected readonly aria = injectGenerativeUIAccessibility();
  /** The src of the failed load: a new url starts unfailed. */
  readonly #failedSrc = signal<string | null>(null);
  protected readonly failed = computed(
    () => this.#failedSrc() !== null && this.#failedSrc() === this.url(),
  );
  protected readonly hovered = signal(false);
  readonly #lightbox = inject(GenerativeUILightbox);
  protected readonly overlayStyle: StyleMap = {
    position: "absolute",
    right: "8px",
    bottom: "8px",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "9999px",
    border: "none",
    background: "var(--a2ui-color-overlay, rgba(0,0,0,.65))",
    color: ON_ACCENT,
    font: "inherit",
    fontSize: ".8125em",
    fontWeight: 500,
    cursor: "pointer",
  };

  protected readonly alt = computed(() => this.description() ?? "");
  protected readonly showsLightbox = computed(
    () => this.lightbox() !== false && !this.failed(),
  );
  protected readonly hasWrapper = computed(
    () => this.actionOverlay() !== undefined || this.hoverZoom() === true,
  );
  protected readonly mode = computed<
    "hidden" | "fallback" | "wrapper" | "plain"
  >(() => {
    const failed = this.failed();
    if (!this.url() || (failed && this.hideOnFailure())) return "hidden";
    if (failed && this.fallback()) return "fallback";
    return this.hasWrapper() ? "wrapper" : "plain";
  });
  /** With an overlay button next to it, hidden and live belong to the pair; the name stays on the image. */
  protected readonly imageAria = computed<GenerativeUIAriaAttributes>(() =>
    this.hasWrapper() ? controlAria(this.aria()) : this.aria(),
  );
  readonly #frame = computed<StyleMap>(() => {
    const variant = IMAGE_VARIANT_STYLE[this.variant() ?? "mediumFeature"];
    return {
      display: "block",
      ...variant,
      aspectRatio: this.aspectRatio() ?? variant.aspectRatio,
      width:
        spacing(this.width()) ??
        (this.aspectRatio() ? "100%" : undefined) ??
        variant.width,
      height: spacing(this.height()) ?? variant.height,
      minWidth: spacing(this.minWidth()),
      minHeight: spacing(this.minHeight()),
      maxWidth: spacing(this.maxWidth()) ?? variant.maxWidth ?? "100%",
      maxHeight: spacing(this.maxHeight()),
      flexGrow: this.weight(),
      boxSizing: "border-box",
      ...radiusStyle(this.radius() ?? variant.borderRadius),
    };
  });
  protected readonly imageStyle = computed<StyleMap>(() => ({
    ...this.#frame(),
    cursor: this.showsLightbox() ? "zoom-in" : undefined,
    objectFit: OBJECT_FIT[this.fit() ?? "cover"],
    objectPosition: this.position(),
    background: backgroundColor(this.background()),
    border: this.frame() ? `1px solid ${borderColor("default")}` : undefined,
    transform: this.hoverZoom() && this.hovered() ? "scale(1.03)" : undefined,
    transition: this.hoverZoom() ? "transform .2s ease" : undefined,
  }));
  protected readonly hostStyle = computed<StyleMap>(() => {
    switch (this.mode()) {
      case "hidden":
        return { display: "none" };
      case "fallback":
        return {
          ...this.#frame(),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing(3),
          background: backgroundColor(this.background() ?? "surface-secondary"),
          color: textColor("secondary"),
          fontSize: ".875em",
          textAlign: "center",
          // A style map adds no unit to a number, so the default is "64px".
          minHeight: spacing(this.minHeight()) ?? "64px",
        };
      case "wrapper":
        return {
          position: "relative",
          display: "inline-block",
          maxWidth: "100%",
          overflow: this.hoverZoom() ? "hidden" : undefined,
          ...radiusStyle(this.radius()),
        };
      default:
        return { display: "contents" };
    }
  });

  // The src of the element, not url(): an error that arrives late belongs to
  // the src that was loading.
  protected onError(event: Event) {
    this.#failedSrc.set((event.target as HTMLImageElement).getAttribute("src"));
  }

  protected open() {
    const url = this.url();
    if (!this.showsLightbox() || !url) return;
    this.#lightbox.open([{ src: url, alt: this.alt() }], 0, this.aria());
  }

  protected onOverlay(
    event: Event,
    overlay: NonNullable<ImageProps["actionOverlay"]>,
  ) {
    event.stopPropagation();
    if (overlay.href) openUrl(overlay.href);
    else this.onOverlayClick()?.({});
  }
}

/** The favicon of the site at a URL. Hidden when the URL has no host. */
@Component({
  selector: "img[copilotGenerativeUIFavicon]",
  template: "",
  host: {
    "[attr.hidden]": "host() ? null : ''",
    "[attr.src]": "src()",
    "[attr.alt]": "alt() ?? host() ?? null",
    "[attr.width]": "size() ?? 16",
    "[attr.height]": "size() ?? 16",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIFavicon {
  readonly url = input<string>();
  readonly alt = input<string>();
  readonly size = input<number>();
  readonly inline = input<boolean>();
  readonly frame = input<boolean>();

  protected readonly host = computed(() => {
    const url = this.url();
    return url ? hostOf(url) : undefined;
  });
  protected readonly src = computed(() => {
    const host = this.host();
    return host ? faviconSrc(host) : null;
  });
  protected readonly style = computed<StyleMap>(() => ({
    display: this.inline() ? "inline-block" : "block",
    verticalAlign: this.inline() ? "middle" : undefined,
    borderRadius: radius("xs"),
    border: this.frame() ? `1px solid ${borderColor("default")}` : undefined,
    padding: this.frame() ? "2px" : undefined,
    background: this.frame() ? backgroundColor("surface") : undefined,
  }));
}
