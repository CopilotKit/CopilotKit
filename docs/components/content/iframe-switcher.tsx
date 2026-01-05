import {
  Tabs,
  Tab,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "fumadocs-ui/components/tabs";
import { Monitor, Code } from "lucide-react";

interface IframeSwitcherProps {
  id?: string;
  exampleUrl: string;
  codeUrl: string;
  height?: string;
  exampleLabel?: string;
  codeLabel?: string;
}

export function IframeSwitcher({
  id,
  exampleUrl,
  codeUrl,
  height = "600px",
  exampleLabel = "Example",
  codeLabel = "Code",
}: IframeSwitcherProps) {
  return (
    <Tabs defaultValue={exampleLabel} id={id}>
      <TabsList>
        <TabsTrigger value={exampleLabel}>
          <Monitor className="w-4 h-4" />
          {exampleLabel}
        </TabsTrigger>
        <TabsTrigger value={codeLabel}>
          <Code className="w-4 h-4" />
          {codeLabel}
        </TabsTrigger>
      </TabsList>
      <TabsContent className="p-0" value={exampleLabel}>
        <iframe
          src={exampleUrl}
          className="w-full rounded-lg"
          style={{ height }}
          title="Interactive Example"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </TabsContent>
      <TabsContent className="p-0" value={codeLabel}>
        <iframe
          src={codeUrl}
          className="w-full rounded-lg"
          style={{ height }}
          title="Code View"
          sandbox="allow-scripts allow-same-origin"
        />
      </TabsContent>
    </Tabs>
  );
}

// Wrapper for multiple IframeSwitcher variants (e.g., different integrations)
interface IframeSwitcherVariant {
  label: string;
  exampleUrl: string;
  codeUrl: string;
}

interface IframeSwitcherGroupProps {
  id?: string;
  variants: IframeSwitcherVariant[];
  height?: string;
  exampleLabel?: string;
  codeLabel?: string;
}

export function IframeSwitcherGroup({
  id,
  variants,
  height = "600px",
  exampleLabel = "Example",
  codeLabel = "Code",
}: IframeSwitcherGroupProps) {
  const items = variants.map((v) => v.label);
  const firstItem = items[0];

  if (!firstItem || variants.length === 0) {
    return null;
  }

  // Single variant - render without outer tabs
  if (variants.length === 1) {
    const variant = variants[0];
    if (!variant) return null;
    
    return (
      <IframeSwitcher
        id={id}
        exampleUrl={variant.exampleUrl}
        codeUrl={variant.codeUrl}
        height={height}
        exampleLabel={exampleLabel}
        codeLabel={codeLabel}
      />
    );
  }

  // Multiple variants - wrap with outer tabs
  return (
    <Tabs groupId={`iframe-switcher-group-${id ?? "default"}`} items={items} defaultIndex={0}>
      {variants.map((variant) => (
        <Tab key={variant.label} value={variant.label} className="p-0">
          <IframeSwitcher
            id={id ? `${id}-${variant.label.toLowerCase().replace(/\s+/g, "-")}` : undefined}
            exampleUrl={variant.exampleUrl}
            codeUrl={variant.codeUrl}
            height={height}
            exampleLabel={exampleLabel}
            codeLabel={codeLabel}
          />
        </Tab>
      ))}
    </Tabs>
  );
}
