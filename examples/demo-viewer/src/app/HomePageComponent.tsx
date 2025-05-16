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
import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Code, Book, Network, Bot, Sparkles } from "lucide-react";
import { CodeEditor } from "@/components/code-editor/code-editor";
import ReactMarkdown from "react-markdown";
import { MarkdownComponents } from "@/components/ui/markdown-components";
import { MDXContent } from "@/components/ui/mdx-components";
import { MDXRenderer, SafeComponent } from "@/utils/mdx-utils";
import filesJson from "../files.json";
import { FileEntry } from "@/components/file-tree/file-tree";
import { useRouter, usePathname, useParams } from "next/navigation";
import { AGENT_TYPE } from "@/config";
// Define a type for the files.json structure for safety
type FilesJsonType = Record<string, { files: { name: string; content: string; path: string; language: string; type: string; }[] }>;

// Define the props expected when rendered by FeaturePage
interface HomePageProps {
  defaultDemoId?: string; // This comes from FeaturePage, can be undefined
}

// Use HomePageProps directly in the function signature
export default function Home({ defaultDemoId }: HomePageProps = {}) {
  // Get the framework type from environment variable
  const params = useParams();
  const currentFramework = params.framework || 'crewai'; // Default to crewai if not set
  // Initialize state with defaultDemoId
  const [selectedDemoId, setSelectedDemoId] = useState<string | undefined>(defaultDemoId);
  const [selectedFramework, setSelectedFramework] = useState<string>(params?.agent as string || (AGENT_TYPE == "general" ? "crewai" : AGENT_TYPE));
  const [toDelete, setToDelete] = useState<boolean>(false);
  // Filter demos based on the selected framework OR if they have an iframeUrl or special ID
  const filteredDemos = config.filter(d =>
    d.id === 'research-canvas' || d.iframeUrl || d.id.startsWith(`${selectedFramework}_`)
  );

  // console.log("filteredDemos : ", filteredDemos);
  // console.log("config : ", config);
  // Find selected demo within the *full* config for its details
  const selectedDemo = config.find((d) => d.id === selectedDemoId);
  const RESEARCH_CANVAS_ID = "research-canvas"; // Define constant for clarity

  const [activeTab, setActiveTab] = useState<string>("preview");
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
  console.log("AGENT_TYPEAGENT_TYPEAGENT_TYPE : ", AGENT_TYPE);
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

  const isNavigatingToRootRef = useRef(false);
  const [mounted, setMounted] = useState(false);

  const { resolvedTheme } = useTheme();

  // Add Effect to set mounted state after client mount
  useEffect(() => {
    setMounted(true);
  }, []);;

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
    // Check if already selected
    debugger
    if (selectedDemoId === fullDemoId) return;

    const demo = config.find(d => d.id === fullDemoId);

    // Resetting common state elements that should happen on *any* selection attempt
    setActiveTab("preview"); // Default to preview tab
    setSelectedFilePath(null);
    setFileContent(null);
    setSelectedDemoId(fullDemoId); // Set state immediately

    // --- URL Handling ---
    if (demo?.id === RESEARCH_CANVAS_ID) {
      // Navigate to the dedicated route for research canvas
      if (pathname !== '/demo/research-canvas') {
        router.push('/demo/research-canvas');
      }
    } else if (demo) {
      // It's a regular internal demo (non-iframe)
      const shortId = fullDemoId.substring(fullDemoId.indexOf('_') + 1);
      if (pathname !== `/${selectedFramework}/feature/${shortId}`) {
        if (AGENT_TYPE === "general") {
          router.push(`/${fullDemoId.split("_")[0]}/feature/${fullDemoId}`);
        }
        else {
          router.push(`/feature/${shortId}`);
        }
      }
    } else {
      // Handle case where demo is not found? Maybe navigate home?
      console.warn(`Demo with ID ${fullDemoId} not found in config.`);
      if (pathname !== '/') {
        router.push('/');
      }
    }

  }, [selectedDemoId, router, pathname]);

  // Effect 1: Sync state from URL prop (defaultDemoId)
  useEffect(() => {
    // Simplified: Always sync state from prop if it's different
    if (defaultDemoId) {
      const demoFromProp = config.find(d => d.id === defaultDemoId);
      if (demoFromProp) {
        if (selectedDemoId !== defaultDemoId) {
          // Prop is valid and differs from state, sync state
          setSelectedDemoId(defaultDemoId);
        }
      } else {
        // Prop is invalid (e.g., from a stale URL)
        console.warn(`Demo ID "${defaultDemoId}" from prop/URL is invalid.`);
        // Optionally navigate home or clear state
        if (selectedDemoId) setSelectedDemoId(undefined);
        if (pathname !== '/') router.push('/'); // Redirect home if URL points to non-existent demo
      }
    } else {
      // On root path ('/') or path without defaultDemoId, ensure state reflects this if needed
      // If current path is not home and there's no defaultDemoId, maybe clear selection?
      // Example: if (pathname !== '/' && selectedDemoId) setSelectedDemoId(undefined);
      // Decide based on desired behavior for root path.
    }
  }, [defaultDemoId, selectedDemoId, pathname, router]); // Rerun when prop, state, or path changes

  // Effect 2: Load content based on selectedDemoId state
  useEffect(() => {
    if (selectedDemoId) {
      const demo = config.find(d => d.id === selectedDemoId);
      if (demo) {
        // Load readme content
        loadReadmeContent(selectedDemoId);
        setCurrentPath(demo.path || "");
        handleFileSelect(null);
      } else {
        // Clear relevant states if ID becomes invalid
        setCurrentPath("");
        setReadmeContent(null);
        setCompiledMDX(null);
        setSelectedFilePath(null);
        setFileContent(null);
      }
    } else {
      // Clear relevant states when no demo is selected
      setCurrentPath("");
      setReadmeContent(null);
      setCompiledMDX(null);
      setSelectedFilePath(null);
      setFileContent(null);
    }
  }, [selectedDemoId, loadReadmeContent, handleFileSelect]); // Dependencies for content loading

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

  const handleFrameworkSelect = (framework: string) => {
    try {
      debugger
      setToDelete(true);
      setSelectedFramework(framework);
      router.push(`/${framework}`);
    } catch (error) {
      console.error("Error handling framework selection:", error);
    }
  }

  return (
    <ViewerLayout showFileTree={false} showCodeEditor={false}>
      <div className="flex h-full">
        {/* Demo List - Left Sidebar */}
        <div className="flex flex-col h-full w-82 border-r">
          {/* === Restore Sidebar Header === */}
          <div className="p-4 border-b bg-background">
            <div className="flex items-center justify-between ml-1">
              <div className="flex items-start flex-col">
                {mounted ? (
                  <Image
                    src={resolvedTheme === 'dark' ? "/logo_light.webp" : "/logo_dark.webp"}
                    width={120}
                    height={24}
                    alt="CopilotKit / Demo Viewer"
                    className="h-6 w-auto object-contain"
                    priority
                  />
                ) : (
                  <div style={{ width: 120, height: 24 }} />
                )}
                <h1
                  className="text-lg font-extralight text-foreground"
                >
                  Interactive Demos
                </h1>
              </div>
              <ThemeToggle />
            </div>
          </div>
          {/* === Restore Controls Section (Tabs) === */}
          {AGENT_TYPE === "general" && <div className="p-4 border-b bg-background">
            <div className="mb-1">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Agent Framework
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => handleFrameworkSelect("crewai")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${selectedFramework === "crewai"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-background border hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                >
                  <Network className="h-3 w-3" />
                  <span>CrewAI</span>
                </button>
                <button
                  onClick={() => handleFrameworkSelect("langgraph")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${selectedFramework === "langgraph"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-background border hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                >
                  <Bot className="h-3 w-3" />
                  <span>LangGraph</span>
                </button>
                <button
                  onClick={() => handleFrameworkSelect("standard")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${selectedFramework === "standard"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-background border hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Standard</span>
                </button>
              </div>
            </div>
          </div>}
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
                {selectedDemo && <DemoPreview demo={selectedDemo} />}
              </div>
            ) : activeTab === "readme" ? (
              <div className="flex-1 p-6 overflow-auto bg-background">
                {selectedDemo?.sourceCodeUrl ? (
                  // External demo: Show link to external README
                  <div className="flex-1 flex flex-col items-center justify-center text-center h-full">
                    <h3 className="text-lg font-semibold mb-3">View Documentation</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      The documentation for this demo is hosted externally on GitHub.
                    </p>
                    <a
                      href="https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md" // Specific README URL
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                      View README on GitHub
                    </a>
                  </div>
                ) : readmeContent ? (
                  // Internal demo with readme content: Render it (existing logic)
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
                ) : (
                  // Internal demo without readme content: Show message (existing logic)
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No README found for this demo.
                  </div>
                )}
              </div>
            ) : activeTab === "code" ? (
              <div className="flex-1 flex h-full">
                {selectedDemo?.sourceCodeUrl ? (
                  // External demo: Show link to GitHub repo
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-background">
                    <h3 className="text-lg font-semibold mb-3">View Source Code</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      The source code for this demo is hosted externally on GitHub.
                    </p>
                    <a
                      href={selectedDemo.sourceCodeUrl} // Use the URL from config
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                      View Source on GitHub
                    </a>
                  </div>
                ) : (
                  // Internal demo: show FileTree and CodeEditor (existing logic)
                  <>
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
                              language: (selectedDemoId && (filesJson as FilesJsonType)[selectedDemoId]?.files.find((f: any) => f.path === selectedFilePath)?.language) || 'plaintext',
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          Select a file to view its content.
                        </div>
                      )}
                    </div>
                  </>
                )}
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