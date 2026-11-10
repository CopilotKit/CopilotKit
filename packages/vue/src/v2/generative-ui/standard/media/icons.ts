import { h, onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { FunctionalComponent } from "vue";
import type { ICON_SIZES, Weight } from "@copilotkit/shared/generative-ui";

/** The pixel size of each named icon size. */
export const ICON_PX: Record<(typeof ICON_SIZES)[number], number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

/** The stroke width of each icon weight. */
export const ICON_STROKE: Record<Weight, number> = {
  normal: 2,
  medium: 2.25,
  semibold: 2.5,
  bold: 3,
};

/**
 * The PascalCase name of a kebab-case icon name.
 *
 * @example kebabToPascal("arrow-down-0-1") // "ArrowDown01"
 */
export function kebabToPascal(name: string) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
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

/**
 * The Lucide name of an icon: an A2UI name maps to its Lucide icon, and any
 * other name stays as it is.
 *
 * @example lucideNameOf("arrowBack") // "arrow-left"
 */
export function lucideNameOf(name: string) {
  return A2UI_ICONS[name] ?? name;
}

/**
 * The ARIA attributes of an icon or a drawing. With a `label`, it is an
 * image with that name. Without one, screen readers skip it.
 *
 * @param label - The name of the icon, or `undefined` for a decorative icon.
 * @param description - The description, used only with a `label`.
 */
export function iconAria(
  label: string | undefined,
  description: string | undefined,
) {
  if (label === undefined) return { "aria-hidden": true };
  return { role: "img", "aria-label": label, "aria-description": description };
}

/** A Lucide icon as the `lucide` package stores it: `[tag, attributes]` pairs. */
type LucideIconData = [
  tag: string,
  attributes: Record<string, string | number>,
][];

/** One Lucide icon as a Vue component that renders its `<svg>`. */
export type LucideIcon = FunctionalComponent;
type IconMap = Record<string, LucideIcon>;
let lucidePromise: Promise<IconMap> | null = null;
let lucideIcons: IconMap | null = null;

/** "ArrowRight" gives "arrow-right", as Lucide names its icon classes. */
function pascalToKebab(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * A component that renders one icon of the `lucide` package as an
 * `svg.lucide.lucide-<name>`: `color` is the stroke, `strokeWidth` the stroke
 * width, and the other attributes go on the `<svg>` as they are.
 */
function lucideComponent(key: string, data: LucideIconData): LucideIcon {
  const className = `lucide lucide-${pascalToKebab(key)}`;
  const icon: LucideIcon = (_props, { attrs }) => {
    const { color, strokeWidth, ...rest } = attrs;
    return h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: 24,
        height: 24,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color ?? "currentColor",
        "stroke-width": strokeWidth ?? 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        class: className,
        ...rest,
      },
      data.map(([tag, attributes]) => h(tag, attributes)),
    );
  };
  icon.inheritAttrs = false;
  return icon;
}

function loadLucideIcons() {
  lucidePromise ??= import("lucide").then(
    (module) => {
      const icons: IconMap = {};
      for (const [key, data] of Object.entries(
        module.icons as Record<string, LucideIconData>,
      )) {
        icons[key] = lucideComponent(key, data);
      }
      lucideIcons = icons;
      return icons;
    },
    (error: unknown) => {
      // A failed import is not kept, so an icon mounted later tries again.
      lucidePromise = null;
      throw error;
    },
  );
  return lucidePromise;
}

/**
 * The Lucide icons, as a ref: `null` until they are loaded. `lucide` (an
 * optional peer dependency) has about 1,500 icons. A static import of its `icons` map
 * puts all of them in every bundle, so the map loads once, on first use, in
 * the browser only. The server renders no icon.
 */
export function useLucideIcons() {
  const icons = shallowRef(lucideIcons);
  if (lucideIcons) return icons;
  let isActive = true;
  onMounted(() => {
    loadLucideIcons().then(
      (loaded) => {
        if (isActive) icons.value = loaded;
      },
      () => {
        // The icon stays hidden.
      },
    );
  });
  onBeforeUnmount(() => (isActive = false));
  return icons;
}
