"use client";

import { Tabs, Tab } from "../docs-tabs";

interface IframeSwitcherProps {
  id?: string;
  exampleUrl: string;
  codeUrl: string;
  exampleLabel?: string;
  codeLabel?: string;
  height?: string;
}

export function IframeSwitcher({
  id,
  exampleUrl,
  codeUrl,
  exampleLabel = "Demo",
  codeLabel = "Code",
  height = "600px",
}: IframeSwitcherProps) {
  const iframeStyle = {
    width: "100%",
    height,
    border: "none",
    borderRadius: "0.375rem",
    background: "var(--bg-surface)",
  };

  return (
    <div id={id}>
      <Tabs items={[exampleLabel, codeLabel]}>
        <Tab value={exampleLabel}>
          <iframe
            src={exampleUrl}
            style={iframeStyle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </Tab>
        <Tab value={codeLabel}>
          <iframe
            src={codeUrl}
            style={iframeStyle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </Tab>
      </Tabs>
    </div>
  );
}
