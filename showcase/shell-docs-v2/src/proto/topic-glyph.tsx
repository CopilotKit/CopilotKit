import type { ComponentType } from "react";
import {
  GenerativeUIGlyph,
  HumanInTheLoopGlyph,
  QuickstartGlyph,
  SharedStateGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import type { TopicSlug } from "./data";

const GLYPHS: Record<TopicSlug, ComponentType<{ className?: string }>> = {
  quickstart: QuickstartGlyph,
  "generative-ui": GenerativeUIGlyph,
  "human-in-the-loop": HumanInTheLoopGlyph,
  "shared-state": SharedStateGlyph,
  threads: ThreadsGlyph,
};

/** A topic's glyph; its tile or row sets the color. */
export function TopicGlyph({ slug }: { slug: TopicSlug }) {
  const Glyph = GLYPHS[slug];
  return <Glyph />;
}
