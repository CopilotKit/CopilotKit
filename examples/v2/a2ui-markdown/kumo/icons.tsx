"use client";

import { useEffect, useState } from "react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { textColorOf } from "./style";
import { standardComponent } from "./types";
import type { StandardProps } from "./types";

/** Every export of `@phosphor-icons/react`, by name. */
export type PhosphorIcons = Record<string, PhosphorIcon | undefined>;

/**
 * The standard Icon description tells the model to write lucide names.
 * These lucide names have a Phosphor icon (Kumo's icon set) with a
 * different name. A name with the same PascalCase name in both sets needs
 * no entry.
 */
export const LUCIDE_TO_PHOSPHOR: Record<string, string> = {
  "alert-circle": "WarningCircle",
  "alert-triangle": "Warning",
  "arrow-up-right": "ArrowUpRight",
  "bar-chart": "ChartBar",
  "bar-chart-2": "ChartBar",
  "bar-chart-3": "ChartBar",
  "book-open": "BookOpen",
  "calendar-days": "CalendarDots",
  "check-circle": "CheckCircle",
  "check-circle-2": "CheckCircle",
  "chevron-down": "CaretDown",
  "chevron-left": "CaretLeft",
  "chevron-right": "CaretRight",
  "chevron-up": "CaretUp",
  "circle-check": "CheckCircle",
  clock: "Clock",
  "dollar-sign": "CurrencyDollar",
  "external-link": "ArrowSquareOut",
  "file-text": "FileText",
  home: "House",
  "info-circle": "Info",
  "line-chart": "ChartLine",
  loader: "Spinner",
  "loader-2": "Spinner",
  mail: "Envelope",
  "map-pin": "MapPin",
  "message-circle": "ChatCircle",
  "message-square": "ChatText",
  "more-horizontal": "DotsThree",
  "more-vertical": "DotsThreeVertical",
  "mouse-pointer-click": "CursorClick",
  "move-horizontal": "ArrowsHorizontal",
  "pie-chart": "ChartPie",
  plane: "Airplane",
  refresh: "ArrowClockwise",
  "refresh-cw": "ArrowClockwise",
  search: "MagnifyingGlass",
  settings: "Gear",
  "shopping-bag": "ShoppingBag",
  "shopping-cart": "ShoppingCart",
  sparkles: "Sparkle",
  "thumbs-up": "ThumbsUp",
  "trash-2": "Trash",
  "trending-down": "TrendDown",
  "trending-up": "TrendUp",
  "user-plus": "UserPlus",
  users: "Users",
  utensils: "ForkKnife",
  wallet: "Wallet",
  "x-circle": "XCircle",
  zap: "Lightning",
  // The lucide names of the A2UI icons below, when they differ.
  "bell-off": "BellSlash",
  "circle-alert": "WarningCircle",
  "circle-question-mark": "Question",
  download: "DownloadSimple",
  ellipsis: "DotsThree",
  "ellipsis-vertical": "DotsThreeVertical",
  "eye-off": "EyeSlash",
  "heart-off": "HeartBreak",
  pencil: "PencilSimple",
  send: "PaperPlaneRight",
  "share-2": "ShareNetwork",
  "triangle-alert": "Warning",
  upload: "UploadSimple",
  "volume-1": "SpeakerLow",
  "volume-2": "SpeakerHigh",
  "volume-off": "SpeakerSlash",
  "volume-x": "SpeakerX",
  // The A2UI icon names, which the standard Icon also accepts.
  accountCircle: "UserCircle",
  add: "Plus",
  arrowBack: "ArrowLeft",
  arrowForward: "ArrowRight",
  attachFile: "Paperclip",
  calendarToday: "Calendar",
  call: "Phone",
  close: "X",
  delete: "Trash",
  edit: "PencilSimple",
  event: "CalendarDots",
  error: "WarningCircle",
  favorite: "Heart",
  favoriteOff: "HeartBreak",
  help: "Question",
  locationOn: "MapPin",
  menu: "List",
  moreHoriz: "DotsThree",
  moreVert: "DotsThreeVertical",
  notifications: "Bell",
  notificationsOff: "BellSlash",
  payment: "CreditCard",
  person: "User",
  photo: "Image",
  print: "Printer",
  share: "ShareNetwork",
  skipNext: "SkipForward",
  skipPrevious: "SkipBack",
  starOff: "Star",
  visibility: "Eye",
  visibilityOff: "EyeSlash",
  volumeDown: "SpeakerLow",
  volumeMute: "SpeakerX",
  volumeOff: "SpeakerSlash",
  volumeUp: "SpeakerHigh",
};

let phosphorPromise: Promise<PhosphorIcons> | null = null;
let phosphorIcons: PhosphorIcons | null = null;

/**
 * Loads `@phosphor-icons/react` once. It has about 1,500 icons, so it loads
 * on demand, like the standard Icon loads lucide.
 */
export function loadPhosphor(): Promise<PhosphorIcons> {
  phosphorPromise ??= import("@phosphor-icons/react").then((module) => {
    phosphorIcons = module as unknown as PhosphorIcons;
    return phosphorIcons;
  });
  return phosphorPromise;
}

const pascal = (name: string) =>
  name.replace(/(^|[-_\s]+)([a-z0-9])/gi, (_, __, char: string) =>
    char.toUpperCase(),
  );

/**
 * The Phosphor icon of a lucide (kebab-case) or PascalCase name, or
 * `undefined` when Phosphor has none.
 */
export function resolvePhosphorIcon(
  name: string,
  icons: PhosphorIcons,
): PhosphorIcon | undefined {
  const mapped = LUCIDE_TO_PHOSPHOR[name];
  const candidates = mapped ? [mapped] : [pascal(name), name];
  for (const candidate of candidates) {
    const icon = icons[candidate];
    if (icon) return icon;
  }
  return undefined;
}

/**
 * The Phosphor icon of `name`. `null` while Phosphor loads, `undefined`
 * when it has no such icon.
 */
export function usePhosphorIcon(
  name: string | undefined,
): PhosphorIcon | null | undefined {
  const [icons, setIcons] = useState(phosphorIcons);
  useEffect(() => {
    if (icons) return;
    let isActive = true;
    void loadPhosphor().then((loaded) => {
      if (isActive) setIcons(loaded);
    });
    return () => {
      isActive = false;
    };
  }, [icons]);
  if (!name) return undefined;
  if (!icons) return null;
  return resolvePhosphorIcon(name, icons);
}

const ICON_PX = { sm: 16, md: 20, lg: 24, xl: 32 } as const;
const PHOSPHOR_WEIGHT: Record<string, IconWeight> = {
  normal: "regular",
  medium: "regular",
  semibold: "bold",
  bold: "bold",
};

const StandardIcon = standardComponent("Icon");

/**
 * Icon: a Phosphor icon, Kumo's icon set. A name Phosphor has no icon for,
 * and an `{ svgPath }`, use the standard (lucide) Icon.
 */
export function Icon(props: StandardProps<"Icon">) {
  const aria = useGenerativeUIAccessibility();
  const name = typeof props.name === "string" ? props.name : undefined;
  const PhosphorIconComponent = usePhosphorIcon(name);
  if (PhosphorIconComponent === undefined) return <StandardIcon {...props} />;
  if (PhosphorIconComponent === null) return null;
  const label = aria["aria-label"] ?? props.label;
  const size = props.size ?? "md";
  const pixels =
    typeof size === "number" ? size : props.inline ? "1em" : ICON_PX[size];
  const a11y =
    label === undefined
      ? { "aria-hidden": true as const }
      : { role: "img", "aria-label": label };
  return (
    <PhosphorIconComponent
      {...a11y}
      size={pixels}
      weight={PHOSPHOR_WEIGHT[props.strokeWeight ?? "normal"]}
      color={textColorOf(props.color) ?? "currentColor"}
      style={{
        flexGrow: props.weight,
        flexShrink: 0,
        verticalAlign: props.inline ? "-0.125em" : undefined,
      }}
    />
  );
}

export const iconOverrides = { Icon: { component: Icon } };
