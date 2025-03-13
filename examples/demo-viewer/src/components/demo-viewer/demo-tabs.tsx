import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, Code, Book } from 'lucide-react';
import { CodeEditor } from '@/components/code-editor/code-editor';
import ReactMarkdown from 'react-markdown';

interface DemoTabsProps {
  selectedFilePath?: string;
  preview?: React.ReactNode;
  fileContent?: string;
  readmeContent?: string;
}

export function DemoTabs({
  selectedFilePath,
  preview,
  fileContent,
  readmeContent,
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

  return (
    <Tabs defaultValue="preview" className="flex-1 flex flex-col">
      <div className="border-b px-4">
        <TabsList>
          <TabsTrigger value="preview" className="gap-2">
            <Eye className="h-4 w-4" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="code" className="gap-2">
            <Code className="h-4 w-4" />
            Code
          </TabsTrigger>
          {readmeContent && (
            <TabsTrigger value="readme" className="gap-2">
              <Book className="h-4 w-4" />
              README
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
        <CodeEditor file={demoFiles.find(f => f.path === selectedFilePath)} />
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