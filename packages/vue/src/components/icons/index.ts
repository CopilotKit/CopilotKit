import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import { ɵcopilotIcons, ɵcopilotIconSvgAttributes } from "@copilotkit/core";
import type { CopilotIconName } from "@copilotkit/core";

/** True when the attributes give the icon an accessible name or role. */
function hasAccessibleAttribute(attributes: object) {
  return Object.keys(attributes).some(
    (key) => key.startsWith("aria-") || key === "role" || key === "title",
  );
}

/** Props that change how an icon is drawn. Other attributes go on the `<svg>`. */
const iconDrawProps = {
  /** Width and height of the icon. Defaults to `24`. */
  size: { type: [Number, String], default: 24 },
  /** Line color. Defaults to `currentColor`. */
  color: { type: String, default: "currentColor" },
  /** Line width. Defaults to `2`. */
  strokeWidth: { type: [Number, String], default: 2 },
};

/**
 * Draws one of the chat icons as an inline `<svg>`.
 *
 * The `<svg>` has the classes `lucide lucide-<icon name>`, so CSS that selects
 * them (for example `svg.lucide-arrow-up`) keeps working. The icon is hidden
 * from screen readers unless you give it an `aria-*` attribute, a `role` or a
 * `title`. Other attributes, such as `class` or `fill`, go on the `<svg>`.
 *
 * Props:
 * - `name`: the chat icon, for example `"ArrowUp"` or `"X"`.
 * - `size`: width and height. Defaults to `24`.
 * - `stroke-width`: line width. Defaults to `2`.
 * - `color`: line color. Defaults to `currentColor`.
 *
 * @example
 * ```vue
 * <CopilotIcon name="ArrowUp" class="cpk-chat-input-send-icon" />
 * <CopilotIcon name="X" aria-label="Close" />
 * ```
 */
export const CopilotIcon = defineComponent({
  name: "CopilotIcon",
  props: {
    /** The chat icon to draw, for example `"ArrowUp"`. */
    name: { type: String as PropType<CopilotIconName>, required: true },
    ...iconDrawProps,
  },
  setup(props, { attrs, slots }) {
    return () => {
      const icon = ɵcopilotIcons[props.name];
      const content = slots.default?.() ?? [];
      const isDecorative =
        content.length === 0 && !hasAccessibleAttribute(attrs);
      return h(
        "svg",
        {
          ...ɵcopilotIconSvgAttributes,
          width: props.size,
          height: props.size,
          stroke: props.color,
          "stroke-width": props.strokeWidth,
          class: ["lucide", `lucide-${icon.name}`],
          "aria-hidden": isDecorative ? "true" : undefined,
        },
        [...icon.nodes.map((node) => h(node.tag, node.attributes)), ...content],
      );
    };
  },
});

/**
 * Internal. Makes a component that draws one chat icon, such as `IconArrowUp`.
 * It takes the same `size`, `color` and `stroke-width` props as `CopilotIcon`.
 */
function defineIcon(name: CopilotIconName) {
  return defineComponent({
    name: `Icon${name}`,
    props: iconDrawProps,
    setup(props, { slots }) {
      return () => h(CopilotIcon, { name, ...props }, slots);
    },
  });
}

export const IconArrowUp = defineIcon("ArrowUp");
export const IconCheck = defineIcon("Check");
export const IconChevronDown = defineIcon("ChevronDown");
export const IconChevronLeft = defineIcon("ChevronLeft");
export const IconChevronRight = defineIcon("ChevronRight");
export const IconCircle = defineIcon("Circle");
export const IconCopy = defineIcon("Copy");
export const IconEdit = defineIcon("Edit");
export const IconEyeOff = defineIcon("EyeOff");
export const IconLoader2 = defineIcon("Loader2");
export const IconMessageCircle = defineIcon("MessageCircle");
export const IconMic = defineIcon("Mic");
export const IconPanelLeftOpen = defineIcon("PanelLeftOpen");
export const IconPlay = defineIcon("Play");
export const IconPlus = defineIcon("Plus");
export const IconRefreshCw = defineIcon("RefreshCw");
export const IconSquare = defineIcon("Square");
export const IconThumbsDown = defineIcon("ThumbsDown");
export const IconThumbsUp = defineIcon("ThumbsUp");
export const IconUpload = defineIcon("Upload");
export const IconVolume2 = defineIcon("Volume2");
export const IconWrench = defineIcon("Wrench");
export const IconX = defineIcon("X");
