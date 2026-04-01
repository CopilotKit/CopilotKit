import {
  Directive,
  Input,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  ViewContainerRef,
} from "@angular/core";
import {
  Overlay,
  OverlayRef,
  OverlayPositionBuilder,
  ConnectedPosition,
} from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from "@angular/core";

@Component({
  selector: "copilot-tooltip-content",
  standalone: true,
  template: `
    <div class="copilot-tooltip-wrapper" [attr.data-position]="position">
      <div class="copilot-tooltip">
        {{ text }}
      </div>
      <div class="copilot-tooltip-arrow"></div>
    </div>
  `,
  styles: [
    `
      .copilot-tooltip-wrapper {
        position: relative;
        display: inline-block;
        animation: fadeIn 0.15s ease-in-out;
      }

      .copilot-tooltip {
        background-color: #1a1a1a;
        color: white;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        max-width: 200px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .copilot-tooltip-arrow {
        position: absolute;
        width: 0;
        height: 0;
        border-style: solid;
      }

      /* Arrow for tooltip below element (arrow points up to tooltip) */
      .copilot-tooltip-wrapper[data-position="below"] .copilot-tooltip-arrow {
        top: -4px;
        left: 50%;
        transform: translateX(-50%);
        border-width: 0 4px 4px 4px;
        border-color: transparent transparent #1a1a1a transparent;
      }

      /* Arrow for tooltip above element (arrow points down to element) */
      .copilot-tooltip-wrapper[data-position="above"] .copilot-tooltip-arrow {
        bottom: -4px;
        left: 50%;
        transform: translateX(-50%);
        border-width: 4px 4px 0 4px;
        border-color: #1a1a1a transparent transparent transparent;
      }

      /* Arrow for tooltip to the left */
      .copilot-tooltip-wrapper[data-position="left"] .copilot-tooltip-arrow {
        right: -4px;
        top: 50%;
        transform: translateY(-50%);
        border-width: 4px 0 4px 4px;
        border-color: transparent transparent transparent #1a1a1a;
      }

      /* Arrow for tooltip to the right */
      .copilot-tooltip-wrapper[data-position="right"] .copilot-tooltip-arrow {
        left: -4px;
        top: 50%;
        transform: translateY(-50%);
        border-width: 4px 4px 4px 0;
        border-color: transparent #1a1a1a transparent transparent;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipContent {
  text = "";
  private _position: "above" | "below" | "left" | "right" = "below";

  get position(): "above" | "below" | "left" | "right" {
    return this._position;
  }

  set position(value: "above" | "below" | "left" | "right") {
    this._position = value;
    this.cdr.markForCheck();
  }

  constructor(private cdr: ChangeDetectorRef) {}
}

@Directive({
  selector: "[copilotTooltip]",
  standalone: true,
})
export class CopilotTooltip implements OnDestroy {
  @Input("copilotTooltip") tooltipText = "";
  @Input() tooltipPosition: "above" | "below" | "left" | "right" = "below";
  @Input() tooltipDelay = 500; // milliseconds

  private overlay = inject(Overlay);
  private overlayPositionBuilder = inject(OverlayPositionBuilder);
  private elementRef = inject(ElementRef);
  private viewContainerRef = inject(ViewContainerRef);

  private overlayRef?: OverlayRef;
  private tooltipTimeout?: number;
  private originalTitle?: string;

  @HostListener("mouseenter")
  onMouseEnter(): void {
    if (!this.tooltipText) return;

    // Store and remove native title to prevent OS tooltip
    const element = this.elementRef.nativeElement;
    if (element.hasAttribute("title")) {
      this.originalTitle = element.getAttribute("title");
      element.removeAttribute("title");
    }

    // Clear any existing timeout
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
    }

    // Set timeout to show tooltip after delay
    this.tooltipTimeout = window.setTimeout(() => {
      this.show();
    }, this.tooltipDelay);
  }

  @HostListener("mouseleave")
  onMouseLeave(): void {
    // Clear timeout if mouse leaves before tooltip shows
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = undefined;
    }

    // Restore original title if it existed
    if (this.originalTitle !== undefined) {
      this.elementRef.nativeElement.setAttribute("title", this.originalTitle);
      this.originalTitle = undefined;
    }

    // Hide tooltip if it's showing
    this.hide();
  }

  private show(): void {
    if (this.overlayRef) {
      return;
    }

    // Create overlay
    const positionStrategy = this.overlayPositionBuilder
      .flexibleConnectedTo(this.elementRef)
      .withPositions(this.getPositions())
      .withPush(false);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: false,
    });

    // Create component portal and attach
    const portal = new ComponentPortal(TooltipContent, this.viewContainerRef);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.instance.text = this.tooltipText;

    // Detect actual position after overlay is positioned
    setTimeout(() => {
      if (this.overlayRef && this.elementRef.nativeElement) {
        const tooltipRect =
          this.overlayRef.overlayElement.getBoundingClientRect();
        const elementRect =
          this.elementRef.nativeElement.getBoundingClientRect();

        let actualPosition: "above" | "below" | "left" | "right" = "below";

        // Determine actual position based on relative positions
        if (tooltipRect.bottom <= elementRect.top) {
          actualPosition = "above";
        } else if (tooltipRect.top >= elementRect.bottom) {
          actualPosition = "below";
        } else if (tooltipRect.right <= elementRect.left) {
          actualPosition = "left";
        } else if (tooltipRect.left >= elementRect.right) {
          actualPosition = "right";
        }

        componentRef.instance.position = actualPosition;
      }
    }, 0);
  }

  private hide(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = undefined;
    }
  }

  private getPositions(): ConnectedPosition[] {
    const positions: Record<string, ConnectedPosition[]> = {
      above: [
        {
          originX: "center",
          originY: "top",
          overlayX: "center",
          overlayY: "bottom",
          offsetY: -12,
        },
      ],
      below: [
        {
          originX: "center",
          originY: "bottom",
          overlayX: "center",
          overlayY: "top",
          offsetY: 12,
        },
      ],
      left: [
        {
          originX: "start",
          originY: "center",
          overlayX: "end",
          overlayY: "center",
          offsetX: -12,
        },
      ],
      right: [
        {
          originX: "end",
          originY: "center",
          overlayX: "start",
          overlayY: "center",
          offsetX: 12,
        },
      ],
    };

    // Prefer below position, but use above as fallback
    const primary = positions[this.tooltipPosition] || positions.below;
    // For below position, add above as first fallback
    const fallbacks =
      this.tooltipPosition === "below"
        ? [
            ...(positions.above || []),
            ...(positions.left || []),
            ...(positions.right || []),
          ]
        : Object.values(positions)
            .filter((p) => p !== primary)
            .flat();

    return [...(primary || []), ...fallbacks];
  }

  ngOnDestroy(): void {
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
    }
    // Restore original title if it existed
    if (this.originalTitle !== undefined) {
      this.elementRef.nativeElement.setAttribute("title", this.originalTitle);
    }
    this.hide();
  }
}
