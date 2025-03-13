'use client';

import { ViewerLayout } from '@/components/layout/viewer-layout';
import { LLMSelector } from '@/components/llm-selector/llm-selector';
import { DemoList } from '@/components/demo-list/demo-list';
import { DemoPreview } from '@/components/demo-viewer/demo-preview';
import { FileTree } from '@/components/file-tree/file-tree';
import { FileTreeNav } from '@/components/file-tree/file-tree-nav';
import { useFs } from '@/hooks/use-fs';
import config from '@/demos/config';
import { LLMProvider } from '@/types/demo';
import { useState, useEffect } from 'react';
import Image from "next/image";
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, Code } from 'lucide-react';
import { CodeEditor } from '@/components/code-editor/code-editor';

export default function Home() {
  const [selectedDemoId, setSelectedDemoId] = useState<string>();
  const selectedDemo = config.find(d => d.id === selectedDemoId);
  const [activeTab, setActiveTab] = useState<string>("preview");
  // Use a simple theme detection for the logo
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false);
  
  const [llmProvider, setLLMProvider] = useState<LLMProvider>(
    selectedDemo?.defaultLLMProvider || 'openai'
  );

  const {
    currentPath,
    files,
    selectedFilePath,
    fileContent,
    error,
    handleFileSelect,
    handleNavigate,
  } = useFs(selectedDemo?.path || '');

  // Check for dark mode using media query
  useEffect(() => {
    // Check if we're in the browser
    if (typeof window !== 'undefined') {
      // Initial check
      setIsDarkTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
      
      // Listen for changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        setIsDarkTheme(e.matches);
      };
      
      mediaQuery.addEventListener('change', handleChange);
      
      // Also check for .dark class which is added by next-themes
      const observer = new MutationObserver(() => {
        setIsDarkTheme(document.documentElement.classList.contains('dark'));
      });
      
      observer.observe(document.documentElement, { 
        attributes: true, 
        attributeFilter: ['class'] 
      });
      
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
        observer.disconnect();
      };
    }
  }, []);

  // Update LLM provider when demo changes
  useEffect(() => {
    if (selectedDemo?.defaultLLMProvider) {
      setLLMProvider(selectedDemo.defaultLLMProvider);
    }
  }, [selectedDemo]);

  // Load initial demo files when demo changes
  useEffect(() => {
    if (selectedDemo?.path) {
      handleNavigate(selectedDemo.path);
    }
  }, [selectedDemo?.path, handleNavigate]);

  // Find agent.py file when switching to code tab
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'code' && files) {
      // Look for agent.py file
      const agentFile = files.find(file => 
        file.name === 'agent.py' || 
        file.path.endsWith('/agent.py')
      );
      
      if (agentFile) {
        handleFileSelect(agentFile.path);
      }
    }
  };

  return (
    <ViewerLayout
      showFileTree={false}
      showCodeEditor={false}
    >
      <div className="flex h-full">
        {/* Demo List - Left Sidebar */}
        <div className="flex flex-col h-full w-64 border-r">
          {/* Sidebar Header */}
          <div className="p-4 border-b bg-background">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">
                Interactive Demos
              </h1>
              <ThemeToggle />
            </div>
          </div>
          
          {/* Controls Section */}
          <div className="p-4 border-b bg-background">
            {/* LLM Selector */}
            <div className="mb-4 w-full">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Language Model
              </label>
              <div className="w-full">
                <LLMSelector value={llmProvider} onChange={setLLMProvider} />
              </div>
            </div>
            
            {/* Preview/Code Tabs */}
            <div className="mb-1">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                View Mode
              </label>
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
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
                </TabsList>
              </Tabs>
            </div>
          </div>
          
          {/* Demo List */}
          <div className="flex-1 overflow-auto">
            <DemoList
              demos={config}
              selectedDemo={selectedDemoId}
              onSelect={setSelectedDemoId}
            />
          </div>
          
          {/* Logo Footer */}
          <div className="p-3 flex justify-center items-center bg-background">
            <div className="flex items-center">
              <Image 
                src={isDarkTheme ? "/logo_light.webp" : "/logo_dark.webp"} 
                width={120}
                height={24} 
                alt="CopilotKit" 
                className="h-6 w-auto object-contain"
              />
            </div>
          </div>
        </div>

        {/* Main Content */}
        {selectedDemo ? (
          <div className="flex-1 flex flex-col">
            {activeTab === "preview" ? (
              <div className="flex-1">
                {selectedDemo && <DemoPreview demo={selectedDemo} />}
              </div>
            ) : (
              <div className="flex-1 flex">
                <div className="w-72 border-r flex flex-col">
                  <FileTreeNav 
                    path={currentPath} 
                    rootPath={selectedDemo?.path || ''} 
                    onNavigate={handleNavigate} 
                  />
                  <div className="flex-1 overflow-auto">
                    <FileTree
                      basePath={currentPath}
                      files={files}
                      selectedFile={selectedFilePath}
                      onFileSelect={handleFileSelect}
                    />
                  </div>
                  {error && (
                    <div className="p-2 text-sm text-red-500">
                      {error}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  {selectedFilePath && fileContent && (
                    <div className="h-full">
                      <CodeEditor file={{
                        name: selectedFilePath?.split('/').pop() || '',
                        path: selectedFilePath || '',
                        content: fileContent,
                        language: selectedFilePath?.endsWith('.py') ? 'python' :
                            selectedFilePath?.endsWith('.ts') || selectedFilePath?.endsWith('.tsx') ? 'typescript' :
                                selectedFilePath?.endsWith('.js') || selectedFilePath?.endsWith('.jsx') ? 'javascript' :
                                'plaintext',
                      }} />
                    </div>
                  )}
                </div>
              </div>
            )}
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
