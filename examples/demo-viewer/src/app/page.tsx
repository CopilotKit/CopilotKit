"use client";

import React from "react";
import { ViewerLayout } from "@/components/layout/viewer-layout";
import { DemoList } from "@/components/demo-list/demo-list";
import { DemoPreview } from "@/components/demo-viewer/demo-preview";
import { FileTree } from "@/components/file-tree/file-tree";
import { FileTreeNav } from "@/components/file-tree/file-tree-nav";
import { useFs } from "@/hooks/use-fs";
import config from "@/config";
import { LLMProvider } from "@/types/demo";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Code, Book } from "lucide-react";
import { CodeEditor } from "@/components/code-editor/code-editor";
import ReactMarkdown from "react-markdown";
import { MarkdownComponents } from "@/components/ui/markdown-components";
import { MDXContent } from "@/components/ui/mdx-components";
import { MDXRenderer, SafeComponent } from "@/utils/mdx-utils";
import filesJson from "../files.json";
import { FileEntry } from "@/components/file-tree/file-tree";
import { useRouter, usePathname } from "next/navigation";

// Define a type for the files.json structure for safety
type FilesJsonType = Record<string, { files: { name: string; content: string; path: string; language: string; type: string; }[] }>;

// Add HomePageProps interface
interface HomePageProps {
  defaultDemoId?: string;
}

export default function Home({ defaultDemoId }: HomePageProps = {}) {
  // Get the framework type from environment variable
  const currentFramework = process.env.NEXT_PUBLIC_AGENT_TYPE || 'crewai'; // Default to crewai if not set
  
  // Initialize state with defaultDemoId
  const [selectedDemoId, setSelectedDemoId] = useState<string | undefined>(defaultDemoId);
  
  // Filter demos based on the environment variable
  const filteredDemos = config.filter(d => d.id.startsWith(`${currentFramework}_`));
  
  // Find selected demo within the *full* config for its details
  const selectedDemo = config.find((d) => d.id === selectedDemoId);
  
  const [activeTab, setActiveTab] = useState<string>("preview");
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [compiledMDX, setCompiledMDX] = useState<string | null>(null);

  // Add router and pathname hooks
  const router = useRouter();
  const pathname = usePathname();

  const [llmProvider, setLLMProvider] = useState<LLMProvider>(
    selectedDemo?.defaultLLMProvider || "openai"
  );

  // Get files for the selected demo safely
  const demoFiles = (selectedDemoId && (filesJson as FilesJsonType)[selectedDemoId]
    ? (filesJson as FilesJsonType)[selectedDemoId].files
    : []
  ).map(file => ({ // Ensure the mapped type matches FileEntry
      ...file,
      type: file.type as "file" | "directory", // Explicitly cast type
      content: file.content ?? "",
      children: undefined // Explicitly add undefined children if needed by FileEntry 
  }));
  
  const [currentPath, setCurrentPath] = useState<string>(selectedDemo?.path || "");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add explicit types to handlers
  const handleFileSelect = useCallback((filePath: string | null): void => {
    setSelectedFilePath(filePath);
    if (filePath && selectedDemoId) {
      const fileData = (filesJson as FilesJsonType)[selectedDemoId]?.files.find((f) => f.path === filePath);
      setFileContent(fileData?.content ?? null);
    } else {
      setFileContent(null);
    }
  }, [selectedDemoId]); // Add dependencies

  const handleNavigate = useCallback((newPath: string): void => {
    setCurrentPath(newPath);
    setSelectedFilePath(null);
    setFileContent(null);
  }, []); // Add dependencies

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsDarkTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) => setIsDarkTheme(e.matches);
      mediaQuery.addEventListener("change", handleChange);
      const observer = new MutationObserver(() => {
        setIsDarkTheme(document.documentElement.classList.contains("dark"));
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
        observer.disconnect();
      };
    }
  }, []);

  useEffect(() => {
    if (selectedDemo?.defaultLLMProvider) {
      setLLMProvider(selectedDemo.defaultLLMProvider);
    }
  }, [selectedDemo]);

  // Load README content from files.json
  const loadReadmeContent = useCallback((demoId: string | undefined): void => {
    if (!demoId) {
      setReadmeContent(null);
      setCompiledMDX(null);
      return;
    }
    const files = (filesJson as FilesJsonType)[demoId]?.files || [];
    const readmeFile = files.find((f: any) => f.name.toLowerCase().includes('readme.'));
    if (!readmeFile) {
      setReadmeContent(null);
      setCompiledMDX(null);
      console.warn(`No README found for ${demoId} in files.json`);
      return;
    }
    
    setReadmeContent(readmeFile.content);

    if (readmeFile.name.endsWith('.mdx')) {
      fetch("/api/mdx/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoId: demoId }), // Send demoId
      })
        .then(async (res) => {
          if (res.ok) {
            const { compiled } = await res.json();
            setCompiledMDX(compiled);
          } else {
            setCompiledMDX(null);
            console.error("MDX processing failed:", await res.text());
          }
        })
        .catch((err) => {
          console.error("Error calling MDX processing API:", err);
          setCompiledMDX(null);
        });
    } else {
      setCompiledMDX(null);
    }
  }, []); // Dependencies for useCallback

  // Implement new handleDemoSelect for URL updates
  const handleDemoSelect = useCallback((fullDemoId: string) => {
    setSelectedDemoId(fullDemoId);
    // Extract the short ID (e.g., "agentic_chat" from "crewai_agentic_chat")
    const shortId = fullDemoId.substring(fullDemoId.indexOf('_') + 1); 
    
    // Update the URL to /feature/[shortId] without full page reload
    // Only push if the path is not already the target feature path
    if (pathname !== `/feature/${shortId}`) {
        router.push(`/feature/${shortId}`);
    }
    // Reset tab to preview when changing demos
    setActiveTab("preview"); 
    // Reset file selection state
    setSelectedFilePath(null);
    setFileContent(null);
    setCurrentPath(config.find(d => d.id === fullDemoId)?.path || ""); // Update current path based on new demo
    loadReadmeContent(fullDemoId); // Load readme for the new demo
  }, [router, pathname, loadReadmeContent]); // Add dependencies

  // Update useEffect for loading initial demo/readme
  useEffect(() => {
    // Prioritize defaultDemoId if provided via props (from URL)
    const initialDemoId = defaultDemoId || selectedDemoId; 
    
    if (initialDemoId) {
      const demoToLoad = config.find(d => d.id === initialDemoId);
      if (demoToLoad) {
        // If the demo exists, load its content
        // We don't need to filter by currentFramework here anymore, 
        // as FeaturePage already validated it based on AGENT_TYPE
        setSelectedDemoId(initialDemoId); // Ensure state is synced if defaultDemoId was used
        setCurrentPath(demoToLoad.path);
        handleFileSelect(null); 
        loadReadmeContent(initialDemoId);
      } else {
        // If the initialDemoId is invalid (shouldn't happen if FeaturePage works correctly)
        // Clear selection and content
        setSelectedDemoId(undefined);
        setReadmeContent(null);
        setCompiledMDX(null);
        setSelectedFilePath(null);
        setFileContent(null);
      }
    } else {
      // If no demo ID is available (neither from prop nor state), clear content
      setReadmeContent(null);
      setCompiledMDX(null);
      setSelectedFilePath(null);
      setFileContent(null);
      // Optionally select the first demo *of the current framework* if no specific demo requested
      // const firstDemoForFramework = filteredDemos[0]?.id;
      // if (firstDemoForFramework) {
      //    handleDemoSelect(firstDemoForFramework); // Use handleDemoSelect to update URL too
      // }
    }
    // Dependencies: defaultDemoId is crucial here. Also include filteredDemos if using the optional fallback.
  }, [defaultDemoId, loadReadmeContent, handleFileSelect]); // Removed selectedDemoId, selectedDemo as they derive from defaultDemoId or state changes handled by handleDemoSelect

  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(value);
    if (value === "code" && demoFiles.length > 0) {
      const agentPyFile = demoFiles.find(
        (file: FileEntry) => file.name === "agent.py"
      );
      if (agentPyFile) {
        handleFileSelect(agentPyFile.path);
      } else {
        handleFileSelect(demoFiles[0]?.path || null);
      }
    }
  }, [demoFiles, handleFileSelect]); // Add dependencies

  return (
    <ViewerLayout showFileTree={false} showCodeEditor={false}>
      <div className="flex h-full">
        {/* Demo List - Left Sidebar */} 
        <div className="flex flex-col h-full w-80 border-r">
          {/* === Restore Sidebar Header === */}
          <div className="p-4 border-b bg-background">
            <div className="flex items-center justify-between ml-1">
              <div className="flex items-start flex-col">
                <Image
                  src={isDarkTheme ? "/logo_light.webp" : "/logo_dark.webp"}
                  width={120}
                  height={24}
                  alt="CopilotKit / Demo Viewer"
                  className="h-6 w-auto object-contain"
                />
                <h1
                  className={`text-lg font-extralight ${
                    isDarkTheme ? "text-white" : "text-gray-900"
                  }`}
                >
                  Interactive Demos
                </h1>
              </div>
              <ThemeToggle />
            </div>
          </div>
          {/* === Restore Controls Section (Tabs) === */}
          <div className="p-4 border-b bg-background">
            <div className="mb-1">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                View
              </label>
              <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className="w-full"
              >
                <TabsList className="w-full h-9 bg-background border shadow-sm rounded-lg p-1">
                  <TabsTrigger
                    value="preview"
                    className="flex-1 h-7 px-2 text-sm font-medium gap-1 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
                  >
                    <Eye className="h-3 w-3" />
                    <span>Preview</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="code"
                    className="flex-1 h-7 px-2 text-sm font-medium gap-1 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
                  >
                    <Code className="h-3 w-3" />
                    <span>Code</span>
                  </TabsTrigger>
                    <TabsTrigger
                      value="readme"
                      className="flex-1 h-7 px-2 text-sm font-medium gap-1 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
                    >
                      <Book className="h-3 w-3" />
                      <span>Docs</span>
                    </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          {/* === Pass Filtered Demos to Demo List === */}
          <div className="flex-1 overflow-auto">
            <DemoList
              demos={filteredDemos} // Pass filtered list based on env var
              selectedDemo={selectedDemoId}
              onSelect={handleDemoSelect}
            />
          </div>
        </div>

        {/* Main Content Area */}
        {selectedDemo ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* === Restore Active Tab Conditional Logic === */}
            {activeTab === "preview" ? (
              <div className="flex-1 h-full"> 
                {/* Preview content (DemoPreview) will be added later */}
                {selectedDemo && <DemoPreview demo={selectedDemo} />} 
              </div>
            ) : activeTab === "readme" && readmeContent ? (
              <div className="flex-1 p-6 overflow-auto bg-background">
                {/* === Restore Readme Content === */}
                <div className="max-w-4xl mx-auto">
                  <div className="prose max-w-none dark:prose-invert">
                    {compiledMDX ? (
                      <MDXContent>
                        <SafeComponent
                          component={() => (
                            <MDXRenderer
                              content={readmeContent}
                              demoId={selectedDemo?.id || undefined}
                            />
                          )}
                          fallback={
                            <div className="p-4 border rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                              Could not render MDX content. Displaying markdown instead.
                              <ReactMarkdown components={MarkdownComponents}>
                                {readmeContent || ""}
                              </ReactMarkdown>
                            </div>
                          }
                        />
                      </MDXContent>
                    ) : (
                      <ReactMarkdown components={MarkdownComponents}>
                        {readmeContent}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              </div>
            ) : activeTab === "code" ? (
              <div className="flex-1 flex h-full">
                 {/* === Restore Code View Content === */}
                 <div className="w-72 border-r flex flex-col bg-background">
                   <FileTreeNav
                     path={currentPath}
                     rootPath={selectedDemo?.path || ""}
                     onNavigate={handleNavigate}
                   />
                   <div className="flex-1 overflow-auto">
                     <FileTree
                       basePath={currentPath}
                       files={demoFiles} 
                       selectedFile={selectedFilePath || undefined}
                       onFileSelect={handleFileSelect}
                     />
                   </div>
                   {error && (
                     <div className="p-2 text-sm text-red-500">{error}</div>
                   )}
                 </div>
                 <div className="flex-1">
                   {selectedFilePath && fileContent !== null ? (
                     <div className="h-full">
                       <CodeEditor
                         file={{
                           name: selectedFilePath?.split("/").pop() || "",
                           path: selectedFilePath || "",
                           content: fileContent ?? "",
                           language: (selectedDemoId && (filesJson as FilesJsonType)[selectedDemoId]?.files.find((f:any) => f.path === selectedFilePath)?.language) || 'plaintext',
                         }}
                       />
                     </div>
                   ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Select a file to view its content.
                      </div>
                   )}
                 </div>
              </div>
            ) : null /* Handle potential invalid tab state */} 
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a demo from the list to get started
          </div>
        )}
      </div>
     </ViewerLayout>
  );
}
