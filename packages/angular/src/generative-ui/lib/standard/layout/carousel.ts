import {
  Component,
  ElementRef,
  InjectionToken,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  SHADOW_SM,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  CAROUSEL_MEDIA_SIZES,
  LayoutProps,
  carouselSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import {
  GENERATIVE_UI_CARD_NESTING,
  provideContainerContext,
} from "../context";
import type { GenerativeUIEventProp } from "../context";
import { GenerativeUILightbox, openUrl } from "../lightbox";
import type { LightboxImage } from "../lightbox";
import { layoutStyle } from "../style";
import type { StyleMap } from "../style";
import { connectVisibleOnce } from "../visible-once";
import {
  CHILDREN_TEMPLATE,
  CopilotGenerativeUILayoutContainer,
  CopilotGenerativeUILayoutProps,
} from "./containers";

type CarouselProps = z.output<typeof carouselSchema>;

/**
 * The width of one slide when the Carousel sets `visibleItems`, so that many
 * slides fill its width (gaps included). `undefined`: slides size to their
 * content. Angular only: React's Carousel does not read `visibleItems` yet.
 */
const GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH = new InjectionToken<
  Signal<string | undefined>
>("GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH");

const ARROW_STYLE: StyleMap = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "32px",
  height: "32px",
  borderRadius: "9999px",
  border: `1px solid ${borderColor("default")}`,
  background: backgroundColor("surface-elevated"),
  color: textColor("default"),
  boxShadow: SHADOW_SM,
  transition: "opacity .15s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "16px",
  lineHeight: 1,
  zIndex: 1,
};

/**
 * A horizontal snap scroller with previous and next arrows. A Carousel
 * always scrolls, so it can always take keyboard focus. With a `label`, it
 * is a named region for screen readers. `activeIndex` is writable: setting
 * it scrolls that slide into view, and a scroll writes the index of the
 * snapped slide back.
 */
@Component({
  selector: "div[copilotGenerativeUICarousel]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div
      #scroller
      data-a2ui-std
      data-a2ui-carousel
      data-a2ui-scroll
      tabindex="0"
      [attr.role]="scrollerRole()"
      [attr.aria-label]="label() ?? null"
      [attr.aria-roledescription]="label() !== undefined ? 'carousel' : null"
      [style]="scrollerStyle()"
      (scroll)="onScroll()"
    >
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
    @if (showArrows() !== false) {
      <button
        type="button"
        [attr.aria-label]="previousLabel() ?? 'Previous'"
        [disabled]="!canPrev()"
        data-a2ui-carousel-arrow="prev"
        [style]="arrowStyle(-1, canPrev())"
        (click)="$event.stopPropagation(); step(-1)"
      >
        ‹
      </button>
      <button
        type="button"
        [attr.aria-label]="nextLabel() ?? 'Next'"
        [disabled]="!canNext()"
        data-a2ui-carousel-arrow="next"
        [style]="arrowStyle(1, canNext())"
        (click)="$event.stopPropagation(); step(1)"
      >
        ›
      </button>
    }
  `,
  providers: [
    provideContainerContext(),
    {
      provide: GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH,
      useFactory: () => inject(CopilotGenerativeUICarousel).slideWidth,
    },
  ],
  host: { style: "position:relative;width:100%;min-width:0" },
})
export class CopilotGenerativeUICarousel {
  readonly align = input<LayoutProps["align"]>();
  readonly justify = input<LayoutProps["justify"]>();
  readonly wrap = input<LayoutProps["wrap"]>();
  readonly gap = input<LayoutProps["gap"]>();
  readonly rowGap = input<LayoutProps["rowGap"]>();
  readonly columnGap = input<LayoutProps["columnGap"]>();
  readonly padding = input<LayoutProps["padding"]>();
  readonly background = input<LayoutProps["background"]>();
  readonly border = input<LayoutProps["border"]>();
  readonly borderColor = input<LayoutProps["borderColor"]>();
  readonly radius = input<LayoutProps["radius"]>();
  readonly width = input<LayoutProps["width"]>();
  readonly height = input<LayoutProps["height"]>();
  readonly minWidth = input<LayoutProps["minWidth"]>();
  readonly maxWidth = input<LayoutProps["maxWidth"]>();
  readonly minHeight = input<LayoutProps["minHeight"]>();
  readonly maxHeight = input<LayoutProps["maxHeight"]>();
  readonly flex = input<LayoutProps["flex"]>();
  readonly weight = input<LayoutProps["weight"]>();
  readonly aspectRatio = input<LayoutProps["aspectRatio"]>();
  readonly scrollable = input<LayoutProps["scrollable"]>();
  readonly clip = input<LayoutProps["clip"]>();
  readonly shadow = input<LayoutProps["shadow"]>();
  readonly inline = input<LayoutProps["inline"]>();
  readonly role = input<LayoutProps["role"]>();
  readonly flush = input<LayoutProps["flush"]>();
  readonly minSize = input<LayoutProps["minSize"]>();
  readonly maxSize = input<LayoutProps["maxSize"]>();
  readonly disableAutoSpacing = input<LayoutProps["disableAutoSpacing"]>();
  readonly label = input<string>();
  readonly visibleItems = input<number>();
  readonly showArrows = input<boolean>();
  readonly activeIndex = model<number>();
  readonly previousLabel = input<string>();
  readonly nextLabel = input<string>();
  readonly snap = input<CarouselProps["snap"]>();
  readonly snapAlign = input<CarouselProps["snapAlign"]>();
  readonly children = input<GenerativeUIChildren>();
  readonly onVisible = input<GenerativeUIEventProp>();

  protected readonly canPrev = signal(false);
  protected readonly canNext = signal(false);
  protected readonly scroller =
    viewChild<ElementRef<HTMLDivElement>>("scroller");
  protected readonly scrollerRole = computed(
    () => this.role() ?? (this.label() !== undefined ? "region" : null),
  );

  readonly #nested = inject(GENERATIVE_UI_CARD_NESTING, { skipSelf: true });
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** See {@link GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH}. */
  readonly slideWidth = computed(() => {
    const count = Math.floor(this.visibleItems() ?? 0);
    if (count < 1) return undefined;
    const gap = spacing(this.gap() ?? 2);
    return `calc((100% - ${count - 1} * ${gap}) / ${count})`;
  });

  protected readonly scrollerStyle = computed<StyleMap>(() => {
    const props: LayoutProps = {
      align: this.align(),
      justify: this.justify(),
      wrap: this.wrap(),
      gap: this.gap(),
      rowGap: this.rowGap(),
      columnGap: this.columnGap(),
      padding: this.padding(),
      background: this.background(),
      border: this.border(),
      borderColor: this.borderColor(),
      radius: this.radius(),
      width: this.width(),
      height: this.height(),
      minWidth: this.minWidth(),
      maxWidth: this.maxWidth(),
      minHeight: this.minHeight(),
      maxHeight: this.maxHeight(),
      flex: this.flex(),
      weight: this.weight(),
      aspectRatio: this.aspectRatio(),
      scrollable: this.scrollable(),
      clip: this.clip(),
      shadow: this.shadow(),
      inline: this.inline(),
      role: this.role(),
      flush: this.flush(),
      minSize: this.minSize(),
      maxSize: this.maxSize(),
      disableAutoSpacing: this.disableAutoSpacing(),
    };
    const snap = this.snap() ?? "proximity";
    return {
      ...layoutStyle(props),
      ...(this.#nested && props.background
        ? { background: panelBackground(props.background) }
        : {}),
      flexDirection: "row",
      gap: spacing(props.gap ?? 2),
      overflowX: "auto",
      scrollSnapType: snap === "none" ? undefined : `x ${snap}`,
      scrollbarWidth: "none",
    };
  });

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
    connectVisibleOnce(() => this.onVisible());
    if (this.#isBrowser) {
      afterNextRender(() => this.#update());
      effect(() => {
        const index = this.activeIndex();
        if (typeof index === "number") untracked(() => this.#scrollTo(index));
      });
    }
  }

  protected arrowStyle(direction: -1 | 1, isEnabled: boolean): StyleMap {
    return {
      ...ARROW_STYLE,
      [direction < 0 ? "left" : "right"]: "4px",
      cursor: isEnabled ? "pointer" : "default",
      opacity: isEnabled ? 1 : 0,
      pointerEvents: isEnabled ? "auto" : "none",
    };
  }

  protected step(direction: -1 | 1) {
    this.#scrollTo(Math.max(0, this.#nearest() + direction));
  }

  protected onScroll() {
    this.#update();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const index = this.#nearest();
      if (index !== this.activeIndex()) this.activeIndex.set(index);
    }, 120);
  }

  #slides() {
    const element = this.scroller()?.nativeElement;
    return Array.from(element?.children ?? []) as HTMLElement[];
  }

  #update() {
    const element = this.scroller()?.nativeElement;
    if (!element) return;
    this.canPrev.set(element.scrollLeft > 4);
    this.canNext.set(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
    );
  }

  #scrollTo(index: number) {
    const element = this.scroller()?.nativeElement;
    const target = this.#slides()[index];
    if (!element || !target) return;
    const left = target.offsetLeft - element.offsetLeft;
    // jsdom has no scrollTo on elements.
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ left, behavior: "smooth" });
    } else {
      element.scrollLeft = left;
    }
  }

  /** The index of the slide nearest to the left edge. */
  #nearest() {
    const element = this.scroller()?.nativeElement;
    if (!element) return 0;
    let best = 0;
    let bestDistance = Infinity;
    this.#slides().forEach((slide, index) => {
      const distance = Math.abs(
        slide.offsetLeft - element.offsetLeft - element.scrollLeft,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }
}

/** A slide of a Carousel: a column that snaps to the start edge. */
@Component({
  selector: "div[copilotGenerativeUICarouselItem]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUICarouselItem extends CopilotGenerativeUILayoutContainer {
  readonly #slideWidth = inject(GENERATIVE_UI_CAROUSEL_SLIDE_WIDTH, {
    optional: true,
    skipSelf: true,
  });

  protected override extraStyle(): StyleMap {
    const width = this.#slideWidth?.();
    return {
      flex: "0 0 auto",
      flexDirection: "column",
      scrollSnapAlign: "start",
      ...(width === undefined ? {} : { width }),
    };
  }
}

/** The width of a CarouselMediaItem by size. */
const CAROUSEL_MEDIA_WIDTH: Record<
  (typeof CAROUSEL_MEDIA_SIZES)[number],
  number
> = { sm: 160, md: 240, lg: 320 };

/**
 * A slide with an image on top. A click on the image opens a lightbox over
 * every media slide of the same carousel, with the clicked one selected.
 * `href` or a bound `onClick` take over the click instead.
 */
@Component({
  selector: "div[copilotGenerativeUICarouselMediaItem]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <img
      [src]="url()"
      [alt]="description() ?? ''"
      loading="lazy"
      [attr.data-a2ui-lightbox-trigger]="showsLightbox() ? '' : null"
      [style]="imageStyle()"
      (click)="onImageClick($event)"
    />
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  providers: [provideContainerContext()],
  host: {
    "data-a2ui-carousel-media": "",
    "[attr.role]": "role() ?? null",
  },
})
export class CopilotGenerativeUICarouselMediaItem extends CopilotGenerativeUILayoutProps {
  readonly url = input.required<string>();
  readonly description = input<string>();
  readonly size = input<(typeof CAROUSEL_MEDIA_SIZES)[number]>();
  readonly href = input<string>();
  readonly lightbox = input<boolean>();
  readonly onClick = input<GenerativeUIEventProp>();
  readonly onVisible = input<GenerativeUIEventProp>();

  readonly #lightbox = inject(GenerativeUILightbox);
  readonly #aria = injectGenerativeUIAccessibility();
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly hasHref = computed(() => {
    const href = this.href();
    return typeof href === "string" && href !== "";
  });
  protected readonly showsLightbox = computed(
    () =>
      this.lightbox() !== false &&
      !this.hasHref() &&
      this.onClick() === undefined,
  );
  protected readonly isClickable = computed(
    () =>
      this.showsLightbox() || this.hasHref() || this.onClick() !== undefined,
  );
  protected readonly imageStyle = computed<StyleMap>(() => ({
    display: "block",
    width: "100%",
    aspectRatio: this.aspectRatio() ?? "4 / 3",
    objectFit: "cover",
    borderRadius: radius("lg"),
    cursor: this.showsLightbox()
      ? "zoom-in"
      : this.isClickable()
        ? "pointer"
        : undefined,
  }));

  constructor() {
    super();
    connectVisibleOnce(() => this.onVisible());
  }

  protected override computeStyle(props: LayoutProps): StyleMap {
    return {
      ...layoutStyle(props),
      flex: "0 0 auto",
      flexDirection: "column",
      scrollSnapAlign: "start",
      width: `${CAROUSEL_MEDIA_WIDTH[this.size() ?? "md"]}px`,
      gap: spacing(props.gap ?? 2),
    };
  }

  protected onImageClick(event: MouseEvent) {
    if (!this.isClickable()) return;
    event.stopPropagation();
    if (this.hasHref()) {
      openUrl(this.href());
      return;
    }
    const onClick = this.onClick();
    if (onClick) {
      onClick({});
      return;
    }
    if (!this.showsLightbox()) return;
    const own = event.currentTarget as HTMLImageElement;
    const scope =
      this.#host.closest("[data-a2ui-carousel]") ?? this.#host.parentElement;
    const slides = Array.from(
      scope?.querySelectorAll<HTMLImageElement>(
        "[data-a2ui-carousel-media] > img",
      ) ?? [],
    );
    const images: LightboxImage[] = slides.map((img) => ({
      src: img.src,
      alt: img.alt,
    }));
    const index = Math.max(
      0,
      slides.findIndex((img) => img === own),
    );
    if (images.length > 0) {
      this.#lightbox.open(images, index, this.#aria());
    } else {
      this.#lightbox.open(
        [{ src: this.url(), alt: this.description() }],
        0,
        this.#aria(),
      );
    }
  }
}
