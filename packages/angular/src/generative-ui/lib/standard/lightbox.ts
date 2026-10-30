import {
  Component,
  Injectable,
  Injector,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from "@angular/core";
import { Overlay } from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import { wrapperAria } from "@copilotkit/core/generative-ui";
import type { GenerativeUIAriaAttributes } from "@copilotkit/core/generative-ui";
import {
  BACKDROP,
  ON_ACCENT,
  SHADOW_MD,
  radius,
} from "@copilotkit/shared/generative-ui";

export interface LightboxImage {
  src: string;
  alt?: string;
}

const BUTTON =
  "position:absolute;border:none;border-radius:9999px;background:rgba(255,255,255,.15);" +
  `color:${ON_ACCENT};cursor:pointer;display:flex;align-items:center;justify-content:center`;

/**
 * A full-screen view of one or more images. A click, Escape or the close
 * button closes it. With several images, the arrows and the arrow keys move
 * between them. Image, ImageGrid and CarouselMediaItem open it through
 * `GenerativeUILightbox`.
 */
@Component({
  selector: "copilot-generative-ui-lightbox",
  template: `
    @if (image(); as image) {
      <img
        [src]="image.src"
        [alt]="image.alt ?? ''"
        style="max-width:min(92vw, 1400px);max-height:92vh;object-fit:contain;border-radius:{{
          imageRadius
        }};box-shadow:{{ shadow }}"
      />
      @if (count() > 1) {
        <span
          data-a2ui-lightbox-counter
          style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:{{
            onAccent
          }};font-size:13px;opacity:.8"
          >{{ current() + 1 }} / {{ count() }}</span
        >
        <button
          type="button"
          aria-label="Previous image"
          data-a2ui-lightbox-arrow="prev"
          (click)="$event.stopPropagation(); step(-1)"
          style="{{
            button
          }};top:50%;left:16px;transform:translateY(-50%);width:44px;height:44px;font-size:28px;line-height:1"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next image"
          data-a2ui-lightbox-arrow="next"
          (click)="$event.stopPropagation(); step(1)"
          style="{{
            button
          }};top:50%;right:16px;transform:translateY(-50%);width:44px;height:44px;font-size:28px;line-height:1"
        >
          ›
        </button>
      }
      <button
        type="button"
        aria-label="Close"
        (click)="$event.stopPropagation(); closed.emit()"
        style="{{
          button
        }};top:16px;right:16px;width:36px;height:36px;font-size:20px;line-height:1"
      >
        ×
      </button>
    }
  `,
  host: {
    role: "dialog",
    "aria-modal": "true",
    "data-a2ui-lightbox": "",
    "[attr.aria-label]": "image()?.alt || 'Image'",
    "[attr.aria-hidden]": "wrapper()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "wrapper()['aria-live'] ?? null",
    "(click)": "closed.emit()",
    style:
      "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out",
    "[style.background]": "backdrop",
  },
})
class CopilotGenerativeUILightbox {
  readonly images = input.required<LightboxImage[]>();
  readonly index = input(0);
  /** The envelope of the image that opened it: hidden and live apply here too. */
  readonly aria = input<GenerativeUIAriaAttributes>({});
  readonly closed = output<void>();

  protected readonly button = BUTTON;
  protected readonly backdrop = BACKDROP;
  protected readonly onAccent = ON_ACCENT;
  protected readonly shadow = SHADOW_MD;
  protected readonly imageRadius = radius("md");

  protected readonly current = linkedSignal(() => this.index());
  protected readonly count = computed(() => this.images().length);
  protected readonly image = computed(
    () => this.images()[Math.min(this.current(), this.count() - 1)],
  );
  protected readonly wrapper = computed(() => wrapperAria(this.aria()));

  step(delta: number) {
    const count = this.count();
    this.current.update((i) => (count === 0 ? 0 : (i + delta + count) % count));
  }
}

/**
 * Opens the lightbox in a CDK overlay. Escape reaches only the newest
 * overlay (CDK's keyboard dispatcher), so a lightbox inside a Modal closes
 * alone, and the Modal only on the next Escape.
 */
@Injectable({ providedIn: "root" })
export class GenerativeUILightbox {
  readonly #overlay = inject(Overlay);
  readonly #injector = inject(Injector);

  /**
   * Shows `images`, starting at `index`. Returns a function that closes it.
   *
   * @param aria - The ARIA attributes of the component that opens it.
   */
  open(
    images: LightboxImage[],
    index = 0,
    aria: GenerativeUIAriaAttributes = {},
  ): () => void {
    if (images.length === 0) return () => {};
    const overlayRef = this.#overlay.create({
      hasBackdrop: false,
      width: "100%",
      height: "100%",
      positionStrategy: this.#overlay.position().global().top("0").left("0"),
      scrollStrategy: this.#overlay.scrollStrategies.block(),
    });
    const ref = overlayRef.attach(
      new ComponentPortal(CopilotGenerativeUILightbox, null, this.#injector),
    );
    ref.setInput("images", images);
    ref.setInput("index", index);
    ref.setInput("aria", aria);
    let isOpen = true;
    const close = () => {
      if (!isOpen) return;
      isOpen = false;
      overlayRef.dispose();
    };
    ref.instance.closed.subscribe(close);
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      } else if (event.key === "ArrowRight") {
        ref.instance.step(1);
      } else if (event.key === "ArrowLeft") {
        ref.instance.step(-1);
      }
    });
    ref.changeDetectorRef.detectChanges();
    return close;
  }
}
