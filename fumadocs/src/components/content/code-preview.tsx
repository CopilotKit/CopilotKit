import { Tabs, Tab } from "fumadocs-ui/components/tabs";

interface CodePreviewProps {
  children: React.ReactNode;
  preview: React.ReactNode;
}

export function CodePreview({ children, preview }: CodePreviewProps) {
  return (
    <Tabs items={["Preview", "Code"]}>
      <Tab value="Preview">
        {preview}
      </Tab>
      <Tab value="Code">
        {children}
      </Tab>
    </Tabs>
  )
}
