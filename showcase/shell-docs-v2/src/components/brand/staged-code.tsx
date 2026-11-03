"use client";

import { createContext, use, type ComponentProps, type ReactNode } from "react";
import {
  CodeBlock,
  CodeBlockTabs,
  Pre,
} from "fumadocs-ui/components/codeblock";
import { cn } from "@/lib/cn";
import {
  CODE_TABS_WINDOW,
  STAGE_WINDOW,
  Stage,
  UNTITLED_VIEWPORT,
  isCommandLang,
} from "./stage";

/** Set inside a staged tab group, so its code blocks don't stage again. */
const OnStage = createContext(false);

/**
 * An MDX code fence: Fumadocs' code block as a white window on the demo
 * stage, commands on the compact stage. Inside a tab group, the group is the
 * window and owns the stage, so the block sits flush under the tabs. Without
 * a title bar, the copy button floats over the code, so the code stops short
 * of it.
 */
export function StagedPre({
  ref: _ref,
  lang,
  ...props
}: ComponentProps<"pre"> & {
  /** The fence's language, read on the server (see `fenceLang`). */
  lang?: string;
}) {
  const onStage = use(OnStage);
  const block = (
    <CodeBlock
      {...props}
      viewportProps={props.title ? undefined : UNTITLED_VIEWPORT}
      className={
        onStage
          ? "m-0 rounded-none border-0 bg-fd-background"
          : `my-0 ${STAGE_WINDOW}`
      }
    >
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
  if (onStage) return block;
  return (
    <Stage compact={isCommandLang(lang)} className="my-6">
      {block}
    </Stage>
  );
}

/**
 * A stage whose window is a tab group of code: the code blocks inside sit
 * flush in it instead of staging again.
 */
export function CodeTabsStage({
  children,
  compact = false,
}: {
  children: ReactNode;
  /** Commands only (see `commandsOnly`): the compact stage. */
  compact?: boolean;
}) {
  return (
    <Stage compact={compact} className="my-6">
      <OnStage value>{children}</OnStage>
    </Stage>
  );
}

/** Fumadocs' code tabs (package managers, file variants) on the stage. */
export function StagedCodeBlockTabs({
  compact,
  ...props
}: ComponentProps<typeof CodeBlockTabs> & { compact?: boolean }) {
  return (
    <CodeTabsStage compact={compact}>
      <CodeBlockTabs
        {...props}
        className={cn(CODE_TABS_WINDOW, "[&>[role=tablist]]:px-2")}
      />
    </CodeTabsStage>
  );
}
