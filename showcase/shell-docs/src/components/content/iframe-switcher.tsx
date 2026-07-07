"use client";

import { Tabs, Tab } from "../docs-tabs";
import { ThemedDemoFrame } from "./themed-demo-frame";

interface IframeSwitcherProps {
  id?: string;
  exampleUrl: string;
  codeUrl: string;
  exampleLabel?: string;
  codeLabel?: string;
  height?: string;
  exampleFrameHeight?: string;
  exampleFrameOffsetY?: string;
  codeFrameHeight?: string;
  codeFrameOffsetY?: string;
}

export function IframeSwitcher({
  id,
  exampleUrl,
  codeUrl,
  exampleLabel = "Demo",
  codeLabel = "Code",
  height = "600px",
  exampleFrameHeight,
  exampleFrameOffsetY,
  codeFrameHeight,
  codeFrameOffsetY,
}: IframeSwitcherProps) {
  const renderFrame = (
    src: string,
    frameHeight = height,
    frameOffsetY?: string,
  ) => (
    <div className="shell-docs-iframe-viewport" style={{ height }}>
      <ThemedDemoFrame
        src={src}
        className="w-full border-0 bg-[var(--card)]"
        style={{
          height: frameHeight,
          transform: frameOffsetY
            ? `translate3d(0, ${frameOffsetY}, 0)`
            : undefined,
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy"
      />
    </div>
  );

  return (
    <div id={id} className="shell-docs-inline-demo shell-docs-iframe-switcher">
      <Tabs items={[exampleLabel, codeLabel]}>
        <Tab
          value={exampleLabel}
          className="shell-docs-iframe-panel shell-docs-iframe-panel-demo"
        >
          {renderFrame(exampleUrl, exampleFrameHeight, exampleFrameOffsetY)}
        </Tab>
        <Tab
          value={codeLabel}
          className="shell-docs-iframe-panel shell-docs-iframe-panel-code"
        >
          {renderFrame(codeUrl, codeFrameHeight, codeFrameOffsetY)}
        </Tab>
      </Tabs>
    </div>
  );
}
