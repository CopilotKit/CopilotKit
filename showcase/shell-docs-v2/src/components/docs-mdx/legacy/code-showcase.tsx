// Import shim for the legacy landing snippet: `<CodeShowcase tabs={[...]}>`
// with one `<CodePanel>` per tab, shown as Fumadocs tabs.
import { Children, isValidElement, type ReactNode } from "react";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

export function CodeShowcase({
  tabs,
  children,
}: {
  tabs: { label: string; icon?: ReactNode; filename?: string }[];
  children?: ReactNode;
}) {
  const panels = Children.toArray(children).filter(isValidElement);
  const labels = tabs.map((t) => t.label);
  return (
    <Tabs items={labels}>
      {panels.map((panel, i) =>
        labels[i] ? (
          <Tab key={labels[i]} value={labels[i]}>
            {panel}
          </Tab>
        ) : null,
      )}
    </Tabs>
  );
}

export function CodePanel({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
