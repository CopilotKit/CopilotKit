import React from 'react';
import ReactMarkdown from 'react-markdown';

interface ReadmeViewerProps {
  content: string;
}

export function ReadmeViewer({ content }: ReadmeViewerProps) {
  return (
    <div className="p-6 prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
} 