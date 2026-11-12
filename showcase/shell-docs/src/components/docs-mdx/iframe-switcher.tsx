import type { ReactNode } from "react";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { DemoFrame } from "@/components/demo-frame";
import { getRegistry } from "./data";
import { showcaseDemoFor } from "./legacy-demos";
import { getDocsScope } from "./page-store";
import { UNSCOPED } from "./scope";
import { InlineDemo } from "./showcase/inline-demo";

/**
 * A hosted demo and its code viewer (shell-docs' `<IframeSwitcher>`), as one
 * demo window with a Demo / Code switch in its bar. Its URLs point at the
 * legacy dojo (feature-viewer), which draws its own chrome, so when the
 * showcase ships the same demo this shows that instead: the live cell and
 * its source, as `<InlineDemo>` does. Anything else keeps the legacy frames.
 */
export function IframeSwitcher({
  id,
  exampleUrl,
  codeUrl,
  exampleLabel = "Demo",
  codeLabel = "Code",
  height = "600px",
}: {
  id?: string;
  exampleUrl: string;
  codeUrl: string;
  exampleLabel?: string;
  codeLabel?: string;
  height?: string;
}) {
  const showcase = showcaseDemoFor(exampleUrl);
  if (showcase) {
    // Shared pages build the URL from `props.framework || "langgraph"`, and
    // nothing passes `framework` here, so on a framework's page show that
    // framework's copy of the demo when its showcase has one.
    const own = getDocsScope().framework;
    const integration =
      own &&
      getRegistry().integrations.some(
        (i) =>
          i.slug === own &&
          i.deployed &&
          i.demos.some((d) => d.id === showcase.demo),
      )
        ? own
        : showcase.integration;
    return (
      <div id={id}>
        <InlineDemo
          scope={UNSCOPED}
          integration={integration}
          demo={showcase.demo}
        />
      </div>
    );
  }
  return (
    <div id={id}>
      <DemoFrame
        views={[
          { label: exampleLabel, src: exampleUrl },
          { label: codeLabel, src: codeUrl },
        ]}
        height={Number.parseInt(height, 10) || 600}
      />
    </div>
  );
}

/**
 * Consecutive switchers, or `variants`: one demo per agent framework variant
 * (LangGraph, WayFlow), each in a tab.
 */
export function IframeSwitcherGroup({
  id,
  variants,
  exampleLabel,
  codeLabel,
  height,
  children,
}: {
  id?: string;
  variants?: { label: string; exampleUrl: string; codeUrl: string }[];
  exampleLabel?: string;
  codeLabel?: string;
  height?: string;
  children?: ReactNode;
}) {
  if (!variants?.length) return <div id={id}>{children}</div>;
  return (
    <div id={id}>
      <Tabs items={variants.map((v) => v.label)}>
        {variants.map((v) => (
          <Tab key={v.label} value={v.label}>
            <IframeSwitcher
              exampleUrl={v.exampleUrl}
              codeUrl={v.codeUrl}
              exampleLabel={exampleLabel}
              codeLabel={codeLabel}
              height={height}
            />
          </Tab>
        ))}
      </Tabs>
    </div>
  );
}
