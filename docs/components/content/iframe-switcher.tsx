import * as React from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "fumadocs-ui/components/tabs";
import { Monitor, Code } from "lucide-react";

interface IframeSwitcherProps {
  exampleUrl: string;
  codeUrl: string;
  id: string;
  height?: string;
  exampleLabel?: string;
  codeLabel?: string;
}

export function IframeSwitcher({
  exampleUrl,
  codeUrl,
  id,
  height = "600px",
  exampleLabel = "Example",
  codeLabel = "Code",
}: IframeSwitcherProps) {
  return (
    <Tabs defaultValue={exampleLabel}>
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
