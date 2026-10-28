import type { ReactNode } from "react";
import { DemoFrame } from "@/components/demo-frame";
import { showcaseDemoFor } from "./legacy-demos";
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
    return (
      <div id={id}>
        <InlineDemo
          scope={UNSCOPED}
          integration={showcase.integration}
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

/** A plain wrapper around consecutive switchers. */
export function IframeSwitcherGroup({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
