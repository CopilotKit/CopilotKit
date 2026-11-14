import {
  textDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIBadge from "./Badge.vue";
import CopilotGenerativeUIBlockquote from "./Blockquote.vue";
import CopilotGenerativeUIBold from "./Bold.vue";
import CopilotGenerativeUICaption from "./Caption.vue";
import CopilotGenerativeUICode from "./Code.vue";
import CopilotGenerativeUIItalic from "./Italic.vue";
import CopilotGenerativeUILabel from "./Label.vue";
import CopilotGenerativeUILink from "./Link.vue";
import CopilotGenerativeUIMarkdown from "./Markdown.vue";
import CopilotGenerativeUIMath from "./Math.vue";
import CopilotGenerativeUIShimmerText from "./ShimmerText.vue";
import CopilotGenerativeUIStrikethrough from "./Strikethrough.vue";
import CopilotGenerativeUIText from "./Text.vue";
import CopilotGenerativeUITitle from "./Title.vue";
import CopilotGenerativeUITooltip from "./Tooltip.vue";
import CopilotGenerativeUIUnderline from "./Underline.vue";

export {
  CopilotGenerativeUIBadge,
  CopilotGenerativeUIBlockquote,
  CopilotGenerativeUIBold,
  CopilotGenerativeUICaption,
  CopilotGenerativeUICode,
  CopilotGenerativeUIItalic,
  CopilotGenerativeUILabel,
  CopilotGenerativeUILink,
  CopilotGenerativeUIMarkdown,
  CopilotGenerativeUIMath,
  CopilotGenerativeUIShimmerText,
  CopilotGenerativeUIStrikethrough,
  CopilotGenerativeUIText,
  CopilotGenerativeUITitle,
  CopilotGenerativeUITooltip,
  CopilotGenerativeUIUnderline,
};

/**
 * The standard text components: the shared declarations with the Vue
 * components. Give them to
 * `createGenerativeUI({ components: { ...textComponents } })`.
 *
 * - Text has a "multiple" `children` slot. The children render inline
 *   after the text.
 * - Tooltip has two "single" slots: `trigger` and `content`.
 * - Link is a plain link. It opens http, https and mailto URLs only.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({
 *   id: "my-app/text@1",
 *   components: { ...textComponents },
 * });
 * ```
 */
export const textComponents = withComponents(textDeclarations, {
  Title: CopilotGenerativeUITitle,
  Text: CopilotGenerativeUIText,
  Caption: CopilotGenerativeUICaption,
  Label: CopilotGenerativeUILabel,
  Bold: CopilotGenerativeUIBold,
  Italic: CopilotGenerativeUIItalic,
  Underline: CopilotGenerativeUIUnderline,
  Strikethrough: CopilotGenerativeUIStrikethrough,
  Badge: CopilotGenerativeUIBadge,
  Blockquote: CopilotGenerativeUIBlockquote,
  Code: CopilotGenerativeUICode,
  Markdown: CopilotGenerativeUIMarkdown,
  Math: CopilotGenerativeUIMath,
  ShimmerText: CopilotGenerativeUIShimmerText,
  Link: CopilotGenerativeUILink,
  Tooltip: CopilotGenerativeUITooltip,
});
