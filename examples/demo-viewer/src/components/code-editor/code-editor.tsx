import React from 'react';
import Editor from '@monaco-editor/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DemoFile } from '@/types/demo';

interface CodeEditorProps {
  file?: DemoFile;
  onFileChange?: (fileName: string, content: string) => void;
}

export function CodeEditor({ file, onFileChange }: CodeEditorProps) {
  const handleEditorChange = (value: string | undefined) => {
    if (value && onFileChange) {
      onFileChange(file!.name, value);
    }
  };

  return file ? (
      <div className="h-full flex flex-col">
        <Editor
            height="100%"
            language={file.language}
            value={file.content}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              readOnly: false,
              wordWrap: 'on',
            }}
            theme="vs-dark"
        />
      </div>
    ) : (
        <div className="p-6 text-center text-muted-foreground">
          Select a file from the file tree to view its code
        </div>
    )
}