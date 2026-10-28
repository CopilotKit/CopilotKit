import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { StackVariants, Variant } from "@/components/stack/stack-variants";
import { DemoFrame } from "@/components/demo-frame";
import { STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Hero } from "@/components/home/hero";
import { ProductTour } from "@/components/home/product-tour";
import { IdeaReference } from "@/components/ideas/reference";
import {
  ClerkMock,
  DirectoryMock,
  ExpoMock,
  PrismaMock,
  ProductTabsMock,
  QuickstartListMock,
  SentryMock,
  StorybookMock,
  StripeMock,
} from "@/components/ideas/ideas";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fumadocs' own code block, on the demo stage (as in src/proto/code.tsx).
    pre: ({ ref: _ref, ...props }) => (
      <Stage className="my-6">
        <CodeBlock {...props} className={`my-0 ${STAGE_WINDOW}`}>
          <Pre>{props.children}</Pre>
        </CodeBlock>
      </Stage>
    ),
    DemoFrame,
    Hero,
    ProductTour,
    IdeaReference,
    ClerkMock,
    DirectoryMock,
    ExpoMock,
    PrismaMock,
    ProductTabsMock,
    QuickstartListMock,
    SentryMock,
    StorybookMock,
    StripeMock,
    StackVariants,
    Variant,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
