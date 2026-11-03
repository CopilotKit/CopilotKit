import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { StackVariants, Variant } from "@/components/stack/stack-variants";
import { DemoFrame } from "@/components/demo-frame";
import { StagedCodeBlockTabs, StagedPre } from "@/components/brand/staged-code";
import { commandsOnly, fenceLang } from "@/components/brand/stage";
import { Hero } from "@/components/home/hero";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fumadocs' own code block, on the demo stage (as in src/proto/code.tsx);
    // a tab group is one window on the stage, its tabs the window's bar.
    pre: (props) => <StagedPre {...props} lang={fenceLang(props.children)} />,
    CodeBlockTabs: (props) => (
      <StagedCodeBlockTabs {...props} compact={commandsOnly(props.children)} />
    ),
    DemoFrame,
    Hero,
    StackVariants,
    Variant,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
