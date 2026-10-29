import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  Renderer2,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { textColor } from "@copilotkit/shared/generative-ui";
import type {
  ICON_SIZES,
  IconSize,
  Weight,
  svgSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GENERATIVE_UI_ICON_LOADER } from "../loaders";
import type { StyleMap } from "../style";

const ICON_PX: Record<(typeof ICON_SIZES)[number], number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};
const ICON_STROKE: Record<Weight, number> = {
  normal: 2,
  medium: 2.25,
  semibold: 2.5,
  bold: 3,
};

/** "arrow-right" gives "ArrowRight". "arrow-down-0-1" gives "ArrowDown01". */
function kebabToPascal(name: string) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** "ArrowRight" gives "arrow-right". */
function pascalToKebab(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** The A2UI basic catalog icon names, and the Lucide icon of each. */
const A2UI_ICONS: Record<string, string> = {
  accountCircle: "circle-user",
  add: "plus",
  arrowBack: "arrow-left",
  arrowForward: "arrow-right",
  attachFile: "paperclip",
  calendarToday: "calendar",
  call: "phone",
  camera: "camera",
  check: "check",
  close: "x",
  delete: "trash-2",
  download: "download",
  edit: "pencil",
  event: "calendar-days",
  error: "circle-alert",
  fastForward: "fast-forward",
  favorite: "heart",
  favoriteOff: "heart-off",
  folder: "folder",
  help: "circle-question-mark",
  home: "house",
  info: "info",
  locationOn: "map-pin",
  lock: "lock",
  lockOpen: "lock-open",
  mail: "mail",
  menu: "menu",
  moreVert: "ellipsis-vertical",
  moreHoriz: "ellipsis",
  notificationsOff: "bell-off",
  notifications: "bell",
  pause: "pause",
  payment: "credit-card",
  person: "user",
  phone: "phone",
  photo: "image",
  play: "play",
  print: "printer",
  refresh: "refresh-cw",
  rewind: "rewind",
  search: "search",
  send: "send",
  settings: "settings",
  share: "share-2",
  shoppingCart: "shopping-cart",
  skipNext: "skip-forward",
  skipPrevious: "skip-back",
  star: "star",
  starHalf: "star-half",
  starOff: "star-off",
  stop: "square",
  upload: "upload",
  visibility: "eye",
  visibilityOff: "eye-off",
  volumeDown: "volume-1",
  volumeMute: "volume-x",
  volumeOff: "volume-off",
  volumeUp: "volume-2",
  warning: "triangle-alert",
};

/** The Lucide name of an icon: an A2UI name maps, any other name passes. */
function lucideNameOf(name: string) {
  return A2UI_ICONS[name] ?? name;
}

/** A lucide core icon: a list of `[tag, attributes]` SVG nodes. */
type IconNode = ReadonlyArray<
  readonly [string, Record<string, string | number>]
>;

/** The data of one Lucide icon: a list of SVG child nodes. */
interface LucideIconData {
  name: string;
  node: IconNode;
}

function isLucideIconData(value: unknown): value is LucideIconData {
  return (
    typeof value === "object" &&
    value !== null &&
    "node" in value &&
    Array.isArray(value.node)
  );
}

function isIconNode(value: unknown): value is IconNode {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "object",
    )
  );
}

/**
 * The icon with `name` in the loaded module. With `lucide` (the loader of
 * `provideGenerativeUIIcons()`), each icon is an exported node list
 * (`ArrowRight`) and `icons` maps every name and alias to it. The static
 * `icon` of an `@lucide/angular` component class (`LucideArrowRight.icon`)
 * is accepted too.
 */
function lucideIconOf(
  module: Record<string, unknown>,
  name: string,
): LucideIconData | undefined {
  const pascal = kebabToPascal(name);
  const icons = module["icons"];
  const fromMap =
    typeof icons === "object" && icons !== null
      ? (icons as Record<string, unknown>)[pascal]
      : undefined;
  if (isIconNode(fromMap)) return { name, node: fromMap };
  for (const key of [pascal, `Lucide${pascal}`, name]) {
    const candidate = module[key];
    if (isIconNode(candidate)) return { name, node: candidate };
    if (isLucideIconData(candidate)) return candidate;
    const icon =
      typeof candidate === "function" || typeof candidate === "object"
        ? (candidate as { icon?: unknown } | null)?.icon
        : undefined;
    if (isLucideIconData(icon)) return icon;
  }
  return undefined;
}

/**
 * The `lucide` module, loaded once per app through the
 * `GENERATIVE_UI_ICON_LOADER`. `null` while it loads, or without a loader.
 */
let lucideModule: Record<string, unknown> | null = null;
let lucidePromise: Promise<Record<string, unknown> | null> | null = null;

function loadLucide(loader: () => Promise<unknown>) {
  lucidePromise ??= loader().then(
    (module) => {
      lucideModule = module as Record<string, unknown>;
      return lucideModule;
    },
    () => null,
  );
  return lucidePromise;
}

/**
 * A Lucide icon by kebab-case (or PascalCase) name, or a 24px `svgPath`.
 * The icons come from `lucide` through `provideGenerativeUIIcons()`;
 * without it, and for an unknown name, the host is hidden. Without a
 * `label`, the icon is hidden from screen readers.
 */
@Component({
  selector: "svg[copilotGenerativeUIIcon]",
  template: "",
  host: {
    focusable: "false",
    viewBox: "0 0 24 24",
    "[attr.hidden]": "hasIcon() ? null : ''",
    "[attr.role]": "nameText() === undefined ? null : 'img'",
    "[attr.aria-label]": "nameText() ?? null",
    "[attr.aria-description]":
      "nameText() === undefined ? null : (describedBy() ?? null)",
    "[attr.aria-hidden]": "nameText() === undefined ? 'true' : null",
    "[attr.width]": "pixels()",
    "[attr.height]": "pixels()",
    "[attr.fill]": "isPath() ? paint() : 'none'",
    "[attr.stroke]": "isPath() ? null : paint()",
    "[attr.stroke-width]": "isPath() ? null : strokeWidth()",
    "[attr.stroke-linecap]": "isPath() ? null : 'round'",
    "[attr.stroke-linejoin]": "isPath() ? null : 'round'",
    "[class]": "classes()",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIIcon {
  /** The schema `name`: a Lucide name, an A2UI name, or `{ svgPath }`. */
  readonly name = input<string | { svgPath: string }>();
  readonly label = input<string>();
  readonly description = input<string>();
  readonly size = input<IconSize>();
  readonly color = input<string>();
  readonly inline = input<boolean>();
  readonly strokeWeight = input<Weight>();
  readonly weight = input<number>();

  readonly #element = inject<ElementRef<SVGElement>>(ElementRef).nativeElement;
  readonly #renderer = inject(Renderer2);
  readonly #loader = inject(GENERATIVE_UI_ICON_LOADER);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #icons = signal(lucideModule);
  protected readonly aria = injectGenerativeUIAccessibility();

  protected readonly isPath = computed(() => typeof this.name() === "object");
  /** The envelope names the icon like `label` does. */
  protected readonly nameText = computed(
    () => this.aria()["aria-label"] ?? this.label(),
  );
  protected readonly describedBy = computed(
    () => this.aria()["aria-description"] ?? this.description(),
  );
  protected readonly pixels = computed(() => {
    const size = this.size() ?? "md";
    if (typeof size === "number") return size;
    return this.inline() ? "1em" : ICON_PX[size];
  });
  protected readonly paint = computed(
    () => textColor(this.color()) ?? "currentColor",
  );
  protected readonly strokeWidth = computed(() => {
    const weight = this.strokeWeight();
    return weight ? ICON_STROKE[weight] : 2;
  });
  protected readonly lucide = computed(() => {
    const name = this.name();
    const icons = this.#icons();
    if (typeof name !== "string" || !name || !icons) return undefined;
    return lucideIconOf(icons, lucideNameOf(name));
  });
  protected readonly hasIcon = computed(
    () => this.isPath() || this.lucide() !== undefined,
  );
  protected readonly classes = computed(() => {
    const icon = this.lucide();
    return icon ? `lucide lucide-${pascalToKebab(icon.name)}` : null;
  });
  protected readonly style = computed<StyleMap>(() => ({
    flexGrow: this.weight(),
    flexShrink: 0,
    display: this.inline() ? "inline-block" : "block",
    verticalAlign: this.inline() ? "-0.125em" : undefined,
  }));

  constructor() {
    const loader = this.#loader;
    if (loader && this.#isBrowser && !lucideModule) {
      let isActive = true;
      inject(DestroyRef).onDestroy(() => (isActive = false));
      void loadLucide(loader).then((module) => {
        if (isActive && module) this.#icons.set(module);
      });
    }
    effect(() => {
      const name = this.name();
      const icon = this.lucide();
      untracked(() => this.#draw(name, icon));
    });
  }

  #draw(
    name: string | { svgPath: string } | undefined,
    icon: LucideIconData | undefined,
  ) {
    const host = this.#element;
    const renderer = this.#renderer;
    while (host.firstChild) renderer.removeChild(host, host.firstChild);
    const nodes: IconNode =
      typeof name === "object" && name !== null
        ? [["path", { d: name.svgPath }]]
        : (icon?.node ?? []);
    for (const [tag, attributes] of nodes) {
      const child = renderer.createElement(tag, "svg");
      for (const [key, value] of Object.entries(attributes)) {
        renderer.setAttribute(child, key, String(value));
      }
      renderer.appendChild(host, child);
    }
  }
}

type SvgProps = z.output<typeof svgSchema>;

/**
 * A vector drawing from primitive shapes only. It has no raw markup, so the
 * model cannot add scripts or event handlers. A number size is pixels (not
 * 4px steps like the layout spacing).
 */
@Component({
  selector: "svg[copilotGenerativeUISvg]",
  template: `
    @for (rect of rects() ?? []; track $index) {
      <svg:rect
        [attr.x]="rect.x"
        [attr.y]="rect.y"
        [attr.width]="rect.width"
        [attr.height]="rect.height"
        [attr.rx]="rect.rx ?? null"
        [attr.fill]="paint(rect.fill)"
        [attr.stroke]="paint(rect.stroke)"
      />
    }
    @for (circle of circles() ?? []; track $index) {
      <svg:circle
        [attr.cx]="circle.cx"
        [attr.cy]="circle.cy"
        [attr.r]="circle.r"
        [attr.fill]="paint(circle.fill)"
        [attr.stroke]="paint(circle.stroke)"
      />
    }
    @for (path of paths() ?? []; track $index) {
      <svg:path
        [attr.d]="path.d"
        [attr.fill]="paint(path.fill)"
        [attr.stroke]="paint(path.stroke)"
        [attr.stroke-width]="path.strokeWidth ?? null"
      />
    }
    @for (line of lines() ?? []; track $index) {
      <svg:line
        [attr.x1]="line.x1"
        [attr.y1]="line.y1"
        [attr.x2]="line.x2"
        [attr.y2]="line.y2"
        [attr.stroke]="paint(line.stroke) ?? 'currentColor'"
      />
    }
    @for (text of texts() ?? []; track $index) {
      <svg:text
        [attr.x]="text.x"
        [attr.y]="text.y"
        [attr.font-size]="text.size ?? null"
        [attr.fill]="paint(text.fill)"
        [attr.text-anchor]="text.anchor ?? null"
        stroke="none"
      >
        {{ text.text }}
      </svg:text>
    }
  `,
  host: {
    xmlns: "http://www.w3.org/2000/svg",
    focusable: "false",
    "[attr.role]": "name() === undefined ? null : 'img'",
    "[attr.aria-label]": "name() ?? null",
    "[attr.aria-description]":
      "name() === undefined ? null : (aria()['aria-description'] ?? null)",
    "[attr.aria-hidden]": "name() === undefined ? 'true' : null",
    "[attr.viewBox]": "viewBox() ?? null",
    "[attr.width]": "width() ?? size() ?? '100%'",
    "[attr.height]": "height() ?? size() ?? null",
    "[attr.fill]": "paint(fill()) ?? 'currentColor'",
    "[attr.stroke]": "paint(stroke())",
    "[attr.stroke-width]": "strokeWidth() ?? null",
    "[attr.stroke-linecap]": "strokeLinecap() ?? null",
    "[attr.stroke-linejoin]": "strokeLinejoin() ?? null",
    "[attr.preserveAspectRatio]": "preserveAspectRatio() ?? null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUISvg {
  readonly viewBox = input<string>();
  readonly label = input<string>();
  readonly width = input<number | string>();
  readonly height = input<number | string>();
  readonly size = input<number | string>();
  readonly color = input<string>();
  readonly fill = input<string>();
  readonly stroke = input<string>();
  readonly strokeWidth = input<number>();
  readonly strokeLinecap = input<SvgProps["strokeLinecap"]>();
  readonly strokeLinejoin = input<SvgProps["strokeLinejoin"]>();
  readonly preserveAspectRatio = input<string>();
  readonly paths = input<SvgProps["paths"]>();
  readonly circles = input<SvgProps["circles"]>();
  readonly rects = input<SvgProps["rects"]>();
  readonly lines = input<SvgProps["lines"]>();
  readonly texts = input<SvgProps["texts"]>();

  protected readonly aria = injectGenerativeUIAccessibility();
  /** The envelope names the drawing like `label` does. */
  protected readonly name = computed(
    () => this.aria()["aria-label"] ?? this.label(),
  );
  protected readonly style = computed<StyleMap>(() => ({
    color: textColor(this.color() ?? "prose"),
    display: "block",
  }));

  /** A token or a CSS color; `null` removes the attribute. */
  protected paint(value: string | undefined) {
    return textColor(value) ?? null;
  }
}
