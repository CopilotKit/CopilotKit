import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  Directive,
  DOCUMENT,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewContainerRef,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  ConnectedPosition,
  Overlay,
  OverlayRef,
  OverlayPositionBuilder,
} from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import type { Subscription } from "rxjs";

type TooltipPosition = "above" | "below" | "left" | "right";
type TooltipSide = "top" | "bottom" | "left" | "right";

const SIDE: Record<TooltipPosition, TooltipSide> = {
  above: "top",
  below: "bottom",
  left: "left",
  right: "right",
};

const POSITION: Record<TooltipSide, TooltipPosition> = {
  top: "above",
  bottom: "below",
  left: "left",
  right: "right",
};

// Radix adds the arrow's height (0.625rem in ui/tooltip.css) to the offset.
const ARROW_SIZE = 10;

// Radix's PopperArrow wrapper: it puts the arrow on the side of the content
// that faces the trigger.
const ARROW_STYLE: Record<TooltipSide, Record<string, string>> = {
  top: {
    left: `calc(50% - ${ARROW_SIZE / 2}px)`,
    bottom: "0",
    transform: "translateY(100%)",
  },
  bottom: {
    left: `calc(50% - ${ARROW_SIZE / 2}px)`,
    top: "0",
    "transform-origin": "center 0",
    transform: "rotate(180deg)",
  },
  left: {
    top: `calc(50% - ${ARROW_SIZE / 2}px)`,
    right: "0",
    "transform-origin": "0 0",
    transform: "translateY(50%) rotate(-90deg) translateX(50%)",
  },
  right: {
    top: `calc(50% - ${ARROW_SIZE / 2}px)`,
    left: "0",
    "transform-origin": "100% 0",
    transform: "translateY(50%) rotate(90deg) translateX(-50%)",
  },
};

// The point the content zooms from: the tip of the arrow.
const TRANSFORM_ORIGIN: Record<TooltipSide, string> = {
  top: `50% calc(100% + ${ARROW_SIZE}px)`,
  bottom: `50% -${ARROW_SIZE}px`,
  left: `calc(100% + ${ARROW_SIZE}px) 50%`,
  right: `-${ARROW_SIZE}px 50%`,
};

/**
 * The tooltip that `copilotTooltip` shows. Same markup and classes as React's
 * `<TooltipContent>` (`ui/tooltip.css` in `@copilotkit/core`).
 */
@Component({
  selector: "copilot-tooltip-content",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      data-copilotkit
      data-slot="tooltip-content"
      class="cpk-tooltip"
      [class]="extraClass()"
      data-align="center"
      data-state="delayed-open"
      [attr.data-side]="side()"
      [style.--radix-tooltip-content-transform-origin]="transformOrigin()"
    >
      <p>{{ textValue() }}</p>
      <span
        role="tooltip"
        [id]="id"
        style="
          position: absolute;
          border: 0;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          word-wrap: normal;
        "
        >{{ textValue() }}</span
      >
      <span style="position: absolute" [style]="arrowStyle()">
        <svg
          class="cpk-tooltip-arrow"
          width="10"
          height="5"
          viewBox="0 0 30 10"
          preserveAspectRatio="none"
          style="display: block"
        >
          <polygon points="0,0 30,0 15,10" />
        </svg>
      </span>
    </div>
  `,
})
export class TooltipContent {
  id = "";
  readonly textValue = signal("");
  /** Classes added to `.cpk-tooltip`. */
  readonly extraClass = signal("");
  readonly side = signal<TooltipSide>("bottom");
  readonly arrowStyle = computed(() => ARROW_STYLE[this.side()]);
  readonly transformOrigin = computed(() => TRANSFORM_ORIGIN[this.side()]);

  get text(): string {
    return this.textValue();
  }

  set text(value: string) {
    this.textValue.set(value);
  }

  get position(): TooltipPosition {
    return POSITION[this.side()];
  }

  set position(value: TooltipPosition) {
    this.side.set(SIDE[value]);
  }
}

let nextTooltipId = 0;
let openTooltip: CopilotTooltip | undefined;

/**
 * Shows a tooltip like React's Radix tooltip: on hover and on keyboard focus,
 * hidden on pointer down, click, blur, scroll, and Escape. Only one tooltip
 * is open at a time.
 */
@Directive({
  selector: "[copilotTooltip]",
  host: {
    "[attr.aria-describedby]": "isOpen() ? contentId : null",
    "[attr.data-state]":
      "tooltipText ? (isOpen() ? 'delayed-open' : 'closed') : null",
    "(pointerenter)": "onPointerEnter($event)",
    "(pointerleave)": "hide()",
    "(pointerdown)": "onPointerDown()",
    "(focus)": "onFocus()",
    "(blur)": "hide()",
    "(click)": "hide()",
  },
})
export class CopilotTooltip implements OnChanges, OnDestroy {
  @Input("copilotTooltip") tooltipText = "";
  @Input() tooltipPosition: TooltipPosition = "below";
  /** Milliseconds to wait on hover. React shows its tooltips at once. */
  @Input() tooltipDelay = 0;
  /** Classes added to the tooltip, like React's `TooltipContent` `className`. */
  @Input() tooltipClass = "";

  private readonly overlay = inject(Overlay);
  private readonly overlayPositionBuilder = inject(OverlayPositionBuilder);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly document = inject(DOCUMENT);

  readonly contentId = `cpk-tooltip-${nextTooltipId++}`;
  readonly isOpen = signal(false);

  private overlayRef?: OverlayRef;
  private contentRef?: ComponentRef<TooltipContent>;
  private positionSubscription?: Subscription;
  private tooltipTimeout?: ReturnType<typeof setTimeout>;
  private originalTitle?: string;
  private pointerDown = false;

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.hide();
  };
  private readonly onPointerUp = (): void => {
    this.pointerDown = false;
  };

  ngOnChanges(): void {
    if (!this.tooltipText) {
      this.hide();
      return;
    }
    if (this.contentRef) this.contentRef.instance.text = this.tooltipText;
  }

  onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === "touch" || !this.tooltipText) return;
    this.clearTimeout();
    if (this.tooltipDelay > 0) {
      this.tooltipTimeout = setTimeout(() => this.show(), this.tooltipDelay);
    } else {
      this.show();
    }
  }

  onPointerDown(): void {
    this.hide();
    this.pointerDown = true;
    this.document.addEventListener("pointerup", this.onPointerUp, {
      once: true,
    });
  }

  onFocus(): void {
    // Keyboard focus opens the tooltip; focus from a click does not.
    if (!this.pointerDown && this.tooltipText) this.show();
  }

  /** Opens the tooltip now, without the hover delay. */
  show(): void {
    this.clearTimeout();
    if (this.overlayRef || !this.tooltipText) return;
    openTooltip?.hide();
    openTooltip = this;

    // Keep the browser's own title tooltip from showing as well.
    const element = this.elementRef.nativeElement;
    if (element.hasAttribute("title")) {
      this.originalTitle = element.getAttribute("title") ?? undefined;
      element.removeAttribute("title");
    }

    const positionStrategy = this.overlayPositionBuilder
      .flexibleConnectedTo(this.elementRef)
      .withPositions(this.getPositions())
      .withFlexibleDimensions(false)
      .withPush(false);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: false,
      panelClass: "cpk-tooltip-pane",
    });

    const portal = new ComponentPortal(TooltipContent, this.viewContainerRef);
    this.contentRef = this.overlayRef.attach(portal);
    this.contentRef.instance.id = this.contentId;
    this.contentRef.instance.text = this.tooltipText;
    this.contentRef.instance.extraClass.set(this.tooltipClass);
    this.contentRef.instance.position = this.tooltipPosition;
    this.positionSubscription = positionStrategy.positionChanges.subscribe(
      ({ connectionPair }) => {
        this.contentRef?.instance.side.set(sideOf(connectionPair));
      },
    );
    this.overlayRef.detachments().subscribe(() => this.hide());
    this.document.addEventListener("keydown", this.onDocumentKeydown, true);
    this.isOpen.set(true);
  }

  hide(): void {
    this.clearTimeout();
    if (openTooltip === this) openTooltip = undefined;
    if (this.originalTitle !== undefined) {
      this.elementRef.nativeElement.setAttribute("title", this.originalTitle);
      this.originalTitle = undefined;
    }
    if (!this.overlayRef) return;
    this.document.removeEventListener("keydown", this.onDocumentKeydown, true);
    this.positionSubscription?.unsubscribe();
    this.positionSubscription = undefined;
    const overlayRef = this.overlayRef;
    this.overlayRef = undefined;
    this.contentRef = undefined;
    overlayRef.dispose();
    this.isOpen.set(false);
  }

  ngOnDestroy(): void {
    this.document.removeEventListener("pointerup", this.onPointerUp);
    this.hide();
  }

  private clearTimeout(): void {
    if (this.tooltipTimeout !== undefined) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = undefined;
    }
  }

  private getPositions(): ConnectedPosition[] {
    const positions: Record<TooltipPosition, ConnectedPosition> = {
      above: {
        originX: "center",
        originY: "top",
        overlayX: "center",
        overlayY: "bottom",
        offsetY: -ARROW_SIZE,
      },
      below: {
        originX: "center",
        originY: "bottom",
        overlayX: "center",
        overlayY: "top",
        offsetY: ARROW_SIZE,
      },
      left: {
        originX: "start",
        originY: "center",
        overlayX: "end",
        overlayY: "center",
        offsetX: -ARROW_SIZE,
      },
      right: {
        originX: "end",
        originY: "center",
        overlayX: "start",
        overlayY: "center",
        offsetX: ARROW_SIZE,
      },
    };
    // Like Radix, flip to the opposite side first when there is no room.
    const opposite: Record<TooltipPosition, TooltipPosition> = {
      above: "below",
      below: "above",
      left: "right",
      right: "left",
    };
    const primary = positions[this.tooltipPosition]
      ? this.tooltipPosition
      : "below";
    const order: TooltipPosition[] = [
      primary,
      opposite[primary],
      ...(Object.keys(positions) as TooltipPosition[]).filter(
        (p) => p !== primary && p !== opposite[primary],
      ),
    ];
    return order.map((p) => positions[p]);
  }
}

function sideOf(pair: ConnectedPosition): TooltipSide {
  if (pair.originY === "top" && pair.overlayY === "bottom") return "top";
  if (pair.originY === "bottom" && pair.overlayY === "top") return "bottom";
  if (pair.originX === "start" && pair.overlayX === "end") return "left";
  return "right";
}
