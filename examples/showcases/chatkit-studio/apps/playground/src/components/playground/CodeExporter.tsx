"use client";

import { useState } from "react";
import { PlaygroundConfig } from "@/types/playground";
import { generateExportFiles } from "@/utils/codeGenerator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface CodeExporterProps {
  config: PlaygroundConfig;
  isOpen: boolean;
  onClose: () => void;
}

export function CodeExporter({ config, isOpen, onClose }: CodeExporterProps) {
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("component");

  const files = generateExportFiles(config);

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedItems((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setCopiedItems((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
        <DialogOverlay className="bg-black/20" />
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 bg-white/50 backdrop-blur-sm border-2 border-white">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-palette-border-container">
            <DialogTitle className="text-xl text-palette-text-primary">Export Code</DialogTitle>
            <DialogDescription className="text-xs text-palette-text-secondary">
              Copy the generated code to integrate the chat component into your application
            </DialogDescription>
          </DialogHeader>

          {/* Collapsible Instructions */}
          <Accordion type="multiple" defaultValue={["install"]} className="mx-6 mt-4">
            {/* Installation */}
            <AccordionItem
              value="install"
              className="border border-palette-border-container rounded-lg px-4 bg-palette-lilac-40010"
            >
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3 text-palette-text-primary">
                📦 Installation
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <p className="text-xs text-palette-text-secondary mb-2">
                  Install required dependencies:
                </p>
                <div className="relative">
                  <pre className="bg-white/50 border border-palette-border-container px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto pr-16">
                    <code>
                      npm install @ag-ui/langgraph@0.0.7 @copilotkit/react-core@1.9.3
                      @copilotkit/react-ui@1.9.3 @copilotkit/runtime@1.9.3
                    </code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleCopy(
                        "npm install @ag-ui/langgraph@0.0.7 @copilotkit/react-core@1.9.3 @copilotkit/react-ui@1.9.3 @copilotkit/runtime@1.9.3",
                        "install"
                      )
                    }
                    className="absolute top-2 right-2 h-6 text-xs px-2"
                  >
                    {copiedItems.has("install") ? "✓" : "Copy"}
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Setup Instructions */}
            <AccordionItem
              value="setup"
              className="border border-palette-border-container rounded-lg px-4 mt-2 bg-palette-lilac-40010"
            >
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3 text-palette-text-primary">
                📋 Setup Instructions
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <ol className="text-xs space-y-1.5 text-palette-text-secondary leading-relaxed">
                  <li>
                    1. Create{" "}
                    <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                      components/MyChat.tsx
                    </code>{" "}
                    and paste the component code
                  </li>
                  <li className="flex items-start gap-1">
                    <span>2.</span>
                    <span>
                      <span className="font-semibold text-primary">🔧 Important:</span> Wrap your
                      app with CopilotKit in{" "}
                      <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                        app/layout.tsx
                      </code>
                    </span>
                  </li>
                  <li>
                    3. <span className="font-semibold text-destructive">⚠️ Replace or Create</span>{" "}
                    <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                      app/api/copilotkit/route.ts
                    </code>{" "}
                    with the API route code
                  </li>
                  <li>
                    4. Add environment variables to{" "}
                    <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                      .env.local
                    </code>
                  </li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            {/* Usage */}
            <AccordionItem
              value="usage"
              className="border border-palette-border-container rounded-lg px-4 mt-2 bg-palette-lilac-40010"
            >
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3 text-palette-text-primary">
                💡 Using Your Component
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <p className="text-xs text-palette-text-secondary leading-relaxed mb-2">
                  After completing setup, you can import and use{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                    &lt;MyChat /&gt;
                  </code>{" "}
                  anywhere in your application.
                </p>
                <div className="relative">
                  <pre className="mt-2 bg-white/50 border border-palette-border-container px-2 py-1.5 rounded-lg text-xs font-mono pr-14">
                    <code>import MyChat from &apos;@/components/MyChat&apos;</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy("import MyChat from '@/components/MyChat'", "import")}
                    className="absolute top-1/2 -translate-y-1/2 right-1 h-5 text-[10px] px-1.5"
                  >
                    {copiedItems.has("import") ? "✓" : "Copy"}
                  </Button>
                </div>
                <div className="relative">
                  <pre className="mt-2 bg-white/50 border border-palette-border-container px-2 py-1.5 rounded-lg text-xs font-mono pr-14">
                    <code>{`<div className="w-1/2 max-h-[400px]">
  <MyChat />
</div>`}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleCopy(
                        `<div className="w-1/2 max-h-[400px]">\n  <MyChat />\n</div>`,
                        "usage"
                      )
                    }
                    className="absolute top-1/2 -translate-y-1/2 right-1 h-5 text-[10px] px-1.5"
                  >
                    {copiedItems.has("usage") ? "✓" : "Copy"}
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* File Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col px-6 pb-6 pt-4 overflow-hidden"
          >
            <TabsList className="w-full justify-start h-9">
              <TabsTrigger value="component" className="text-xs">
                MyChat.tsx
              </TabsTrigger>
              <TabsTrigger value="layout" className="text-xs">
                layout.tsx
              </TabsTrigger>
              <TabsTrigger value="apiRoute" className="text-xs">
                route.ts
              </TabsTrigger>
              <TabsTrigger value="envVars" className="text-xs">
                .env.local
              </TabsTrigger>
            </TabsList>

            <TabsContent value="component" className="flex-1 mt-3 overflow-auto">
              <div className="relative">
                <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                  <code>{files.component}</code>
                </pre>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleCopy(files.component, "component")}
                  className="absolute top-3 right-3 h-7 text-xs"
                >
                  {copiedItems.has("component") ? "✓ Copied!" : "Copy"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="layout" className="flex-1 mt-3 overflow-auto">
              <div className="relative">
                <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                  <code>{files.layout}</code>
                </pre>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleCopy(files.layout, "layout")}
                  className="absolute top-3 right-3 h-7 text-xs"
                >
                  {copiedItems.has("layout") ? "✓ Copied!" : "Copy"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="apiRoute" className="flex-1 mt-3 overflow-auto">
              <div className="relative">
                <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                  <code>{files.apiRoute}</code>
                </pre>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleCopy(files.apiRoute, "apiRoute")}
                  className="absolute top-3 right-3 h-7 text-xs"
                >
                  {copiedItems.has("apiRoute") ? "✓ Copied!" : "Copy"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="envVars" className="flex-1 mt-3 overflow-auto">
              <div className="relative">
                <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                  <code>{files.envVars}</code>
                </pre>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleCopy(files.envVars, "envVars")}
                  className="absolute top-3 right-3 h-7 text-xs"
                >
                  {copiedItems.has("envVars") ? "✓ Copied!" : "Copy"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
