import {
  textDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import { CopilotGenerativeUIMarkdown } from "./markdown";
import { CopilotGenerativeUIMath } from "./math";
import { CopilotGenerativeUITooltip } from "./tooltip";
import {
  CopilotGenerativeUIBadge,
  CopilotGenerativeUIBlockquote,
  CopilotGenerativeUIBold,
  CopilotGenerativeUICaption,
  CopilotGenerativeUICode,
  CopilotGenerativeUIItalic,
  CopilotGenerativeUILabel,
  CopilotGenerativeUILink,
  CopilotGenerativeUIShimmerText,
  CopilotGenerativeUIStrikethrough,
  CopilotGenerativeUIText,
  CopilotGenerativeUITitle,
  CopilotGenerativeUIUnderline,
} from "./typography";

// The standard text components. Each host element is the element React
// renders, with the same data attributes and inline styles, so the shared
// stylesheet and the theme apply unchanged.

export { CopilotGenerativeUIMarkdown, safeHref } from "./markdown";
export { CopilotGenerativeUIMath, preloadMathRenderer } from "./math";
export { CopilotGenerativeUITooltip } from "./tooltip";
export {
  CopilotGenerativeUIBadge,
  CopilotGenerativeUIBlockquote,
  CopilotGenerativeUIBold,
  CopilotGenerativeUICaption,
  CopilotGenerativeUICode,
  CopilotGenerativeUIItalic,
  CopilotGenerativeUILabel,
  CopilotGenerativeUILink,
  CopilotGenerativeUIShimmerText,
  CopilotGenerativeUIStrikethrough,
  CopilotGenerativeUIText,
  CopilotGenerativeUITitle,
  CopilotGenerativeUIUnderline,
} from "./typography";

/**
 * The standard text components. Give them to
 * `createGenerativeUI({ components: { ...textComponents } })`.
 *
 * - Text has a "multiple" `children` slot. The children render inline
 *   after the text.
 * - Tooltip has two "single" slots: `trigger` and `content`.
 * - Link is a plain link. It opens http, https and mailto URLs only.
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
