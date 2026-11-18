// The SVG data in this file is copied from Lucide v0.525.0 (ISC license).
// The full license notice is above the data, and in LUCIDE-LICENSE.md.

/**
 * One SVG child element of a chat icon, such as a `<path>` or a `<rect>`.
 *
 * Draw it as `<{tag} {...attributes} />` inside the icon's `<svg>`.
 */
export interface CopilotIconNode {
  readonly tag: "path" | "rect" | "circle" | "polygon";
  /** SVG attributes for the element, for example `{ d: "M5 12h14" }`. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** The SVG child elements of one chat icon, in drawing order. */
export type CopilotIconData = readonly CopilotIconNode[];

/** One chat icon: its Lucide name and its SVG child elements. */
export interface CopilotIconDefinition {
  /**
   * The Lucide icon name in kebab case, for example `"arrow-up"`.
   *
   * Put `lucide lucide-<name>` in the `<svg>` class so CSS that selects
   * Lucide classes (such as `.lucide-copy`) keeps working.
   */
  readonly name: string;
  readonly nodes: CopilotIconData;
}

/*! @license
 * The icon data below is copied from Lucide v0.525.0 (https://lucide.dev).
 * The Lucide license follows. A copy is in LUCIDE-LICENSE.md next to this file.
 * This comment sits right above runtime code so the bundler keeps it in dist.
 *
 * ISC License
 *
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

function path(d: string) {
  return { tag: "path" as const, attributes: { d } };
}

const icons = {
  ArrowUp: {
    name: "arrow-up",
    nodes: [path("m5 12 7-7 7 7"), path("M12 19V5")],
  },
  Check: {
    name: "check",
    nodes: [path("M20 6 9 17l-5-5")],
  },
  ChevronDown: {
    name: "chevron-down",
    nodes: [path("m6 9 6 6 6-6")],
  },
  ChevronLeft: {
    name: "chevron-left",
    nodes: [path("m15 18-6-6 6-6")],
  },
  ChevronRight: {
    name: "chevron-right",
    nodes: [path("m9 18 6-6-6-6")],
  },
  Circle: {
    name: "circle",
    nodes: [{ tag: "circle", attributes: { cx: "12", cy: "12", r: "10" } }],
  },
  Copy: {
    name: "copy",
    nodes: [
      {
        tag: "rect",
        attributes: {
          width: "14",
          height: "14",
          x: "8",
          y: "8",
          rx: "2",
          ry: "2",
        },
      },
      path("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"),
    ],
  },
  Edit: {
    name: "square-pen",
    nodes: [
      path("M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"),
      path(
        "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
      ),
    ],
  },
  EyeOff: {
    name: "eye-off",
    nodes: [
      path(
        "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      ),
      path("M14.084 14.158a3 3 0 0 1-4.242-4.242"),
      path(
        "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      ),
      path("m2 2 20 20"),
    ],
  },
  Loader2: {
    name: "loader-circle",
    nodes: [path("M21 12a9 9 0 1 1-6.219-8.56")],
  },
  MessageCircle: {
    name: "message-circle",
    nodes: [path("M7.9 20A9 9 0 1 0 4 16.1L2 22Z")],
  },
  Mic: {
    name: "mic",
    nodes: [
      path("M12 19v3"),
      path("M19 10v2a7 7 0 0 1-14 0v-2"),
      {
        tag: "rect",
        attributes: { x: "9", y: "2", width: "6", height: "13", rx: "3" },
      },
    ],
  },
  PanelLeftOpen: {
    name: "panel-left-open",
    nodes: [
      {
        tag: "rect",
        attributes: { width: "18", height: "18", x: "3", y: "3", rx: "2" },
      },
      path("M9 3v18"),
      path("m14 9 3 3-3 3"),
    ],
  },
  Play: {
    name: "play",
    nodes: [{ tag: "polygon", attributes: { points: "6 3 20 12 6 21 6 3" } }],
  },
  Plus: {
    name: "plus",
    nodes: [path("M5 12h14"), path("M12 5v14")],
  },
  RefreshCw: {
    name: "refresh-cw",
    nodes: [
      path("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
      path("M21 3v5h-5"),
      path("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
      path("M8 16H3v5"),
    ],
  },
  Square: {
    name: "square",
    nodes: [
      {
        tag: "rect",
        attributes: { width: "18", height: "18", x: "3", y: "3", rx: "2" },
      },
    ],
  },
  ThumbsDown: {
    name: "thumbs-down",
    nodes: [
      path("M17 14V2"),
      path(
        "M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",
      ),
    ],
  },
  ThumbsUp: {
    name: "thumbs-up",
    nodes: [
      path("M7 10v12"),
      path(
        "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
      ),
    ],
  },
  Upload: {
    name: "upload",
    nodes: [
      path("M12 3v12"),
      path("m17 8-5-5-5 5"),
      path("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
    ],
  },
  Volume2: {
    name: "volume-2",
    nodes: [
      path(
        "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
      ),
      path("M16 9a5 5 0 0 1 0 6"),
      path("M19.364 18.364a9 9 0 0 0 0-12.728"),
    ],
  },
  Wrench: {
    name: "wrench",
    nodes: [
      path(
        "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
      ),
    ],
  },
  X: {
    name: "x",
    nodes: [path("M18 6 6 18"), path("m6 6 12 12")],
  },
} satisfies Record<string, CopilotIconDefinition>;

/** The name of a chat icon in `ɵcopilotIcons`, for example `"ArrowUp"`. */
export type CopilotIconName = keyof typeof icons;

/**
 * Internal. The SVG data for every icon the chat components draw.
 *
 * Each framework's `CopilotIcon` component reads an entry and draws it:
 *
 * ```ts
 * const { name, nodes } = ɵcopilotIcons.ArrowUp;
 * // <svg {...ɵcopilotIconSvgAttributes} class="lucide lucide-arrow-up">
 * //   one child element per node: <{node.tag} {...node.attributes} />
 * // </svg>
 * ```
 */
export const ɵcopilotIcons: Readonly<
  Record<CopilotIconName, CopilotIconDefinition>
> = icons;

/**
 * Internal. The attributes to put on the `<svg>` of every chat icon.
 *
 * These are Lucide's default attributes, so a drawn icon matches the Lucide
 * icon. Set `width` and `height` to change the size.
 */
export const ɵcopilotIconSvgAttributes: Readonly<Record<string, string>> = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};
