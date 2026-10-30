import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { ɵcopilotIcons, ɵcopilotIconSvgAttributes } from "@copilotkit/core";
import type { CopilotIconData } from "@copilotkit/core";
import { cn } from "../../utils";

export type { CopilotIconData, CopilotIconNode } from "@copilotkit/core";

/** Lucide names of the icons from `@copilotkit/core`, keyed by their data. */
const lucideNames = new Map(
  Object.values(ɵcopilotIcons).map(({ nodes, name }) => [nodes, name]),
);

/**
 * Draws one chat icon from SVG data, such as `ArrowUp` from this file.
 *
 * The icon is decorative (`aria-hidden`). Put the accessible name on the
 * button or link that holds it.
 *
 * ```html
 * <copilot-icon [img]="ArrowUpIcon" iconClass="cpk-chat-input-send-icon" />
 * ```
 *
 * An icon from `@copilotkit/core` also gets the `lucide lucide-<name>`
 * classes, so CSS that selects Lucide classes applies to it.
 */
@Component({
  selector: "copilot-icon",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "aria-hidden": "true" },
  styles: `
    :host {
      display: contents;
    }

    svg {
      display: block;
    }
  `,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.viewBox]="svgAttributes['viewBox']"
      [attr.fill]="svgAttributes['fill']"
      [attr.stroke]="svgAttributes['stroke']"
      [attr.stroke-width]="svgAttributes['stroke-width']"
      [attr.stroke-linecap]="svgAttributes['stroke-linecap']"
      [attr.stroke-linejoin]="svgAttributes['stroke-linejoin']"
      focusable="false"
      aria-hidden="true"
      [attr.class]="svgClass()"
      [attr.width]="size()"
      [attr.height]="size()"
    >
      @for (node of img(); track $index) {
        @switch (node.tag) {
          @case ("path") {
            <path [attr.d]="node.attributes['d']" />
          }
          @case ("rect") {
            <rect
              [attr.x]="node.attributes['x']"
              [attr.y]="node.attributes['y']"
              [attr.width]="node.attributes['width']"
              [attr.height]="node.attributes['height']"
              [attr.rx]="node.attributes['rx']"
              [attr.ry]="node.attributes['ry']"
            />
          }
          @case ("circle") {
            <circle
              [attr.cx]="node.attributes['cx']"
              [attr.cy]="node.attributes['cy']"
              [attr.r]="node.attributes['r']"
            />
          }
          @case ("polygon") {
            <polygon [attr.points]="node.attributes['points']" />
          }
        }
      }
    </svg>
  `,
})
export class CopilotIcon {
  /** The SVG data to draw, for example `ArrowUp` from this file. */
  readonly img = input.required<CopilotIconData>();
  /** Width and height of the `<svg>` in pixels. */
  readonly size = input(24);
  /** Class for the `<svg>`. Its CSS width and height override `size`. */
  readonly iconClass = input<string | undefined>();

  protected readonly svgAttributes = ɵcopilotIconSvgAttributes;

  protected readonly svgClass = computed(() => {
    const name = lucideNames.get(this.img());
    return cn(name && `lucide lucide-${name}`, this.iconClass()) || null;
  });
}

// The chat icons from `@copilotkit/core` (Lucide data). Pass one to `img`.
export const ArrowUp = ɵcopilotIcons.ArrowUp.nodes;
export const Check = ɵcopilotIcons.Check.nodes;
export const ChevronDown = ɵcopilotIcons.ChevronDown.nodes;
export const ChevronLeft = ɵcopilotIcons.ChevronLeft.nodes;
export const ChevronRight = ɵcopilotIcons.ChevronRight.nodes;
export const Circle = ɵcopilotIcons.Circle.nodes;
export const Copy = ɵcopilotIcons.Copy.nodes;
export const Edit = ɵcopilotIcons.Edit.nodes;
export const EyeOff = ɵcopilotIcons.EyeOff.nodes;
export const Loader2 = ɵcopilotIcons.Loader2.nodes;
export const MessageCircle = ɵcopilotIcons.MessageCircle.nodes;
export const Mic = ɵcopilotIcons.Mic.nodes;
export const PanelLeftOpen = ɵcopilotIcons.PanelLeftOpen.nodes;
export const Play = ɵcopilotIcons.Play.nodes;
export const Plus = ɵcopilotIcons.Plus.nodes;
export const RefreshCw = ɵcopilotIcons.RefreshCw.nodes;
export const Square = ɵcopilotIcons.Square.nodes;
export const ThumbsDown = ɵcopilotIcons.ThumbsDown.nodes;
export const ThumbsUp = ɵcopilotIcons.ThumbsUp.nodes;
export const Upload = ɵcopilotIcons.Upload.nodes;
export const Volume2 = ɵcopilotIcons.Volume2.nodes;
export const Wrench = ɵcopilotIcons.Wrench.nodes;
export const X = ɵcopilotIcons.X.nodes;
