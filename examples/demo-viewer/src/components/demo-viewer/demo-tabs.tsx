import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, Code, Book } from 'lucide-react';
import { CodeEditor } from '@/components/code-editor/code-editor';
import ReactMarkdown from 'react-markdown';
import { FileEntry } from '@/components/file-tree/file-tree';

interface DemoTabsProps {
  selectedFilePath?: string;
  preview?: React.ReactNode;
  fileContent?: string;
  readmeContent?: string;
  fileTree?: React.ReactNode;
  onFileSelect?: (path: string) => void;
  files?: FileEntry[];
}

export function DemoTabs({
  selectedFilePath,
  preview,
  fileContent,
  readmeContent,
  fileTree,
  onFileSelect,
  files,
}: DemoTabsProps) {
  const demoFiles = fileContent ? [
    {
      name: selectedFilePath?.split('/').pop() || '',
      path: selectedFilePath || '',
      content: fileContent,
      language: selectedFilePath?.endsWith('.py') ? 'python' :
          selectedFilePath?.endsWith('.ts') || selectedFilePath?.endsWith('.tsx') ? 'typescript' :
              selectedFilePath?.endsWith('.js') || selectedFilePath?.endsWith('.jsx') ? 'javascript' :
               'plaintext',
    }
  ] : [];

  // Find agent.py file when switching to code tab
  const handleTabChange = (value: string) => {
    if (value === 'code' && onFileSelect && files) {
      // Look for agent.py file
      const agentFile = files.find(file => 
        file.name === 'agent.py' || 
        file.path.endsWith('/agent.py')
      );
      
      if (agentFile) {
        onFileSelect(agentFile.path);
      }
    }
  };

  return (
    <Tabs defaultValue="preview" className="flex-1 flex flex-col relative" onValueChange={handleTabChange}>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <TabsList className="h-9 bg-background border shadow-md rounded-lg p-1">
          <TabsTrigger 
            value="preview" 
            className="h-7 px-4 text-sm font-medium gap-2 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
          >
            <Eye className="h-4 w-4" />
            <span>Preview</span>
          </TabsTrigger>
          <TabsTrigger 
            value="code" 
            className="h-7 px-4 text-sm font-medium gap-2 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
          >
            <Code className="h-4 w-4" />
            <span>Code</span>
          </TabsTrigger>
          {readmeContent && (
            <TabsTrigger 
              value="readme" 
              className="h-7 px-4 text-sm font-medium gap-2 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
            >
              <Book className="h-4 w-4" />
              <span>README</span>
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      <TabsContent value="preview" className="flex-1 p-0 m-0">
        {preview || (
          <div className="p-6 text-center text-muted-foreground">
            No preview available
          </div>
        )}
      </TabsContent>

      <TabsContent value="code" className="flex-1 p-0 m-0">
        <div className="flex h-full">
          {fileTree}
          <div className="flex-1">
            <CodeEditor file={demoFiles.find(f => f.path === selectedFilePath)} />
          </div>
        </div>
      </TabsContent>

      {readmeContent && (
        <TabsContent value="readme" className="flex-1 p-0 m-0">
          <div className="p-6 prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{readmeContent}</ReactMarkdown>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
} 