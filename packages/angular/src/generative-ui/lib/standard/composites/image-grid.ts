import { Component, computed, inject, input } from "@angular/core";
import { radius, spacing } from "@copilotkit/shared/generative-ui";
import type {
  gridImage,
  imageGridSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import { GenerativeUILightbox, openUrl } from "../lightbox";
import type { StyleMap } from "../style";
import { SECONDARY_XS } from "./styles";

type GridImageItem = z.output<typeof gridImage>;
type ImageGridProps = z.output<typeof imageGridSchema>;

/** A gallery of images in a grid. A click opens the lightbox. */
@Component({
  selector: "div[copilotGenerativeUIImageGrid]",
  template: `
    @for (image of shownImages(); track $index) {
      <figure [style]="figureStyle($index)">
        <img
          [src]="image.url"
          [alt]="image.description ?? ''"
          loading="lazy"
          (click)="onImageClick(image, $index)"
          [style]="imageStyle(image, $index)"
        />
        @if (image.caption) {
          <figcaption [style]="captionStyle">{{ image.caption }}</figcaption>
        }
      </figure>
    }
  `,
  host: {
    "data-a2ui-image-grid": "",
    "data-a2ui-std": "",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIImageGrid {
  readonly images = input<GridImageItem[]>();
  readonly columns = input<number>();
  readonly aspectRatio = input<string>();
  readonly gap = input<number | string>();
  readonly layout = input<ImageGridProps["layout"]>();

  readonly #lightbox = inject(GenerativeUILightbox);
  readonly #aria = injectGenerativeUIAccessibility();

  protected readonly shownImages = computed(() => this.images() ?? []);
  protected readonly columnCount = computed(() =>
    Math.max(1, Math.floor(this.columns() ?? 3)),
  );
  protected readonly isBento = computed(
    () => this.layout() === "bento" && this.shownImages().length > 1,
  );
  // React renders nothing without images; the host hides itself instead.
  protected readonly style = computed<StyleMap>(() =>
    this.shownImages().length === 0
      ? { display: "none" }
      : {
          display: "grid",
          "grid-template-columns": `repeat(${this.columnCount()}, minmax(0, 1fr))`,
          "grid-auto-flow": this.isBento() ? "dense" : undefined,
          gap: spacing(this.gap() ?? 2),
          width: "100%",
        },
  );
  protected readonly captionStyle = SECONDARY_XS;

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected figureStyle(index: number): StyleMap {
    const isLead = this.isBento() && index === 0;
    return {
      margin: 0,
      "min-width": 0,
      "grid-column": isLead
        ? `span ${Math.min(2, this.columnCount())}`
        : undefined,
      "grid-row": isLead ? "span 2" : undefined,
      display: "flex",
      "flex-direction": "column",
      gap: "4px",
    };
  }

  protected imageStyle(image: GridImageItem, index: number): StyleMap {
    const isLead = this.isBento() && index === 0;
    return {
      display: "block",
      width: "100%",
      height: "100%",
      "aspect-ratio": isLead ? undefined : (this.aspectRatio() ?? "1 / 1"),
      "object-fit": "cover",
      "border-radius": radius("md"),
      cursor: image.href ? "pointer" : "zoom-in",
    };
  }

  protected onImageClick(image: GridImageItem, index: number) {
    if (image.href) {
      openUrl(image.href);
      return;
    }
    this.#lightbox.open(
      this.shownImages().map((item) => ({
        src: item.url,
        alt: item.description,
      })),
      index,
      this.#aria(),
    );
  }
}
