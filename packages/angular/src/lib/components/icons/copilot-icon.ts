import { ChangeDetectionStrategy, Component, input } from "@angular/core";

export interface CopilotIconNode {
  readonly tag: "path" | "rect";
  readonly attributes: Readonly<Record<string, string>>;
}

export type CopilotIconData = readonly CopilotIconNode[];

/** Framework-independent renderer for the small Lucide subset used by chat. */
@Component({
  selector: "copilot-icon",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "aria-hidden": "true" },
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }

    svg {
      display: block;
    }
  `,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      aria-hidden="true"
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
        }
      }
    </svg>
  `,
})
export class CopilotIcon {
  readonly img = input.required<CopilotIconData>();
  readonly size = input(24);
}

function path(d: string): CopilotIconNode {
  return { tag: "path", attributes: { d } };
}

function rect(attributes: Readonly<Record<string, string>>): CopilotIconNode {
  return { tag: "rect", attributes };
}

// Icon paths are from Lucide (ISC), limited to the subset used by chat.
export const ArrowUp: CopilotIconData = [
  path("m5 12 7-7 7 7"),
  path("M12 19V5"),
];
export const Check: CopilotIconData = [path("M20 6 9 17l-5-5")];
export const ChevronDown: CopilotIconData = [path("m6 9 6 6 6-6")];
export const ChevronLeft: CopilotIconData = [path("m15 18-6-6 6-6")];
export const ChevronRight: CopilotIconData = [path("m9 18 6-6-6-6")];
export const Copy: CopilotIconData = [
  rect({ width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }),
  path("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"),
];
export const Edit: CopilotIconData = [
  path("M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"),
  path(
    "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
  ),
];
export const Mic: CopilotIconData = [
  path("M12 19v3"),
  path("M19 10v2a7 7 0 0 1-14 0v-2"),
  rect({ x: "9", y: "2", width: "6", height: "13", rx: "3" }),
];
export const Plus: CopilotIconData = [path("M5 12h14"), path("M12 5v14")];
export const RefreshCw: CopilotIconData = [
  path("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
  path("M21 3v5h-5"),
  path("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
  path("M8 16H3v5"),
];
export const ThumbsDown: CopilotIconData = [
  path("M17 14V2"),
  path(
    "M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",
  ),
];
export const ThumbsUp: CopilotIconData = [
  path("M7 10v12"),
  path(
    "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
  ),
];
export const Upload: CopilotIconData = [
  path("M12 3v12"),
  path("m17 8-5-5-5 5"),
  path("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
];
export const Volume2: CopilotIconData = [
  path(
    "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
  ),
  path("M16 9a5 5 0 0 1 0 6"),
  path("M19.364 18.364a9 9 0 0 0 0-12.728"),
];
export const X: CopilotIconData = [path("M18 6 6 18"), path("m6 6 12 12")];
