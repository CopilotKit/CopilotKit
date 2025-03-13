'use client';

import { ViewerLayout } from '@/components/layout/viewer-layout';
import { LLMSelector } from '@/components/llm-selector/llm-selector';
import { BrandSelector } from '@/components/brand-selector/brand-selector';
import { DemoList } from '@/components/demo-list/demo-list';
import { DemoTabs } from '@/components/demo-viewer/demo-tabs';
import { DemoPreview } from '@/components/demo-viewer/demo-preview';
import { FileTree } from '@/components/file-tree/file-tree';
import { FileTreeNav } from '@/components/file-tree/file-tree-nav';
import { useFs } from '@/hooks/use-fs';
import config from '@/demos/config';
import { LLMProvider } from '@/types/demo';
import { useState, useEffect } from 'react';

export default function Home() {
  const [selectedDemoId, setSelectedDemoId] = useState<string>();
  const selectedDemo = config.find(d => d.id === selectedDemoId);
  
  const [llmProvider, setLLMProvider] = useState<LLMProvider>(
    selectedDemo?.defaultLLMProvider || 'openai'
  );
  const [brand, setBrand] = useState('default');

  const {
    currentPath,
    files,
    selectedFilePath,
    fileContent,
    error,
    handleFileSelect,
    handleNavigate,
  } = useFs(selectedDemo?.path || '');

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

  return (
    <ViewerLayout
      llmSelector={<LLMSelector value={llmProvider} onChange={setLLMProvider} />}
      brandSelector={<BrandSelector value={brand} onChange={setBrand} />}
      showFileTree={false}
      showCodeEditor={false}
    >
      <div className="flex h-full">
        {/* Demo List - Left Sidebar */}
        <DemoList
          demos={config}
          selectedDemo={selectedDemoId}
          onSelect={setSelectedDemoId}
        />

        {/* Main Content */}
        {selectedDemo ? (
          <div className="flex-1 flex flex-col">
            <div className="p-6 border-b">
              <h1 className="text-2xl font-bold">{selectedDemo.name}</h1>
              <p className="text-muted-foreground mt-2">
                {selectedDemo.description}
              </p>
            </div>

            <DemoTabs
              selectedFilePath={selectedFilePath}
              fileContent={fileContent}
              preview={selectedDemo && <DemoPreview demo={selectedDemo} />}
              onFileSelect={handleFileSelect}
              files={files}
              fileTree={
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
              }
            />
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
