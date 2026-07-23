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
  return (
    <div id={id}>
      <Tabs items={[exampleLabel, codeLabel]}>
        <Tab value={exampleLabel}>
          <iframe
            src={exampleUrl}
            className="shell-docs-radius-surface w-full border-0 bg-[var(--bg-surface)]"
            style={{ height }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </Tab>
        <Tab value={codeLabel}>
          <iframe
            src={codeUrl}
            className="shell-docs-radius-surface w-full border-0 bg-[var(--bg-surface)]"
            style={{ height }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </Tab>
      </Tabs>
    </div>
  );
}
