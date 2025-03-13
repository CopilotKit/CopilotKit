import React from 'react';
import { ViewerConfig } from '@/types/demo';
import { cn } from '@/lib/utils';

interface ViewerLayoutProps extends ViewerConfig {
  className?: string;
  children?: React.ReactNode;
  codeEditor?: React.ReactNode;
  fileTree?: React.ReactNode;
  llmSelector?: React.ReactNode;
  brandSelector?: React.ReactNode;
}

export function ViewerLayout({
  className,
  children,
  codeEditor,
  fileTree,
  llmSelector,
  brandSelector,
  showCodeEditor = true,
  showFileTree = true,
  showLLMSelector = true,
  showBrandSelector = true,
}: ViewerLayoutProps) {
  return (
    <div className={cn('flex h-screen flex-col', className)}>
      <header className="flex h-14 items-center border-b px-6 bg-background">
        <div className="flex flex-1">
          {showBrandSelector && brandSelector}
        </div>
        <div className="flex items-center gap-4">
          {showLLMSelector && llmSelector}
        </div>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        {showFileTree && (
          <aside className="w-64 border-r bg-muted/20">
            {fileTree}
          </aside>
        )}
        
        <main className="flex-1 overflow-auto">
          <div className="h-full">{children}</div>
        </main>

        {showCodeEditor && (
          <aside className="w-1/3 border-l bg-muted/20">
            {codeEditor}
          </aside>
        )}
      </div>
    </div>
  );
} 