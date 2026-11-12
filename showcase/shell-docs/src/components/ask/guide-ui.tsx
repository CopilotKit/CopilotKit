"use client";

import type { ComponentType } from "react";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import {
  createGenerativeUI,
  standardUI,
  type GenerativeUITheme,
} from "@copilotkit/react-core/v2/generative-ui";
import { STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { brandDark, brandLight } from "@/proto/code-theme";
import { withLineBreaks } from "./guide-markdown";

/*
 * The generative UI of the full-page Ask CopilotKit: the standard catalog,
 * less the components a docs answer never needs (media, maps, pickers), so
 * every run's catalog stays small. Code draws as the docs draw it.
 */

/** Never useful in a docs answer or a guide; dropped to keep runs small. */
const OMIT = [
  "Map",
  "Video",
  "AudioPlayer",
  "HtmlView",
  "Svg",
  "Image",
  "ImageGrid",
  "Carousel",
  "CarouselItem",
  "CarouselMediaItem",
  "FlashcardFlip",
  "Modal",
  "Slider",
  "DateTimeInput",
  "Math",
  "PulseIndicator",
  "Favicon",
] as const;

/** The standard Code component's props: the code and its language. */
function GuideCode({ text, language }: { text: string; language?: string }) {
  const lang = language?.trim() || "text";
  return (
    <Stage compact className="my-1 shadow-none">
      <DynamicCodeBlock
        lang={lang}
        code={withLineBreaks(text).replace(/\n$/, "")}
        codeblock={{
          title: lang === "text" ? "Code" : lang,
          className: `my-0 ${STAGE_WINDOW}`,
        }}
        options={{ themes: { light: brandLight, dark: brandDark } }}
      />
    </Stage>
  );
}

type MarkdownProps = { text: string; streaming?: boolean };
const StandardMarkdown = standardUI.components.get("Markdown")!
  .component as ComponentType<MarkdownProps>;

/** The standard Markdown, with its line breaks. */
function GuideMarkdown({ text, ...props }: MarkdownProps) {
  return <StandardMarkdown {...props} text={withLineBreaks(text)} />;
}

export const guideUI = createGenerativeUI({
  id: "copilotkit/docs-ask@1",
  extends: [standardUI.omit([...OMIT])],
  overrides: {
    Code: { component: GuideCode },
    Markdown: { component: GuideMarkdown },
  },
  components: {},
});

/**
 * The guide target's vocabulary: a document, not an app. The agent gets the
 * list, and anything else is rejected, so every guide reads (and exports to
 * markdown) the same way.
 */
export const GUIDE_COMPONENTS = [
  "Column",
  "Row",
  "Card",
  "Title",
  "Text",
  "Markdown",
  "Code",
  "Caption",
  "Badge",
  "Blockquote",
  "Divider",
  "List",
  "ListItem",
  "Tabs",
  "Table",
  "TableSection",
  "TableRow",
  "TableCell",
  "Link",
  "LinkCard",
  "CheckBox",
] as const;

/**
 * The catalog in the docs' palette and type. Values point at the theme's
 * shadcn variables, so dark mode follows the site's own switch.
 */
export const GUIDE_THEME: GenerativeUITheme = {
  "--a2ui-font-family": "var(--font-sans)",
  "--a2ui-color-accent": "var(--primary)",
  "--a2ui-color-on-accent": "var(--primary-foreground)",
  "--a2ui-color-focus": "var(--ring)",
  "--a2ui-color-panel": "var(--background)",
  "--a2ui-color-text-default": "var(--foreground)",
  "--a2ui-color-text-secondary": "var(--muted-foreground)",
  "--a2ui-color-border-default": "var(--border)",
  "--a2ui-color-border-subtle": "var(--border)",
  "--a2ui-color-border-control": "var(--input)",
};
