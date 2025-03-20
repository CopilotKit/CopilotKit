import React from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileTreeProps {
  basePath: string;
  files: FileEntry[];
  onFileSelect: (path: string) => void;
  selectedFile?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}

function FileTreeNode({ 
  entry, 
  depth = 0,
  onFileSelect,
  selectedFile
}: { 
  entry: FileEntry; 
  depth?: number;
  onFileSelect: (path: string) => void;
  selectedFile?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(true);
  const isDirectory = entry.type === 'directory';
  const isSelected = entry.path === selectedFile;

  return (
    <div>
      <button
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent/50',
          isSelected && 'bg-accent',
          depth > 0 && 'ml-4'
        )}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen);
          } else {
            onFileSelect(entry.path);
          }
        }}
      >
        {isDirectory ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Folder className="h-4 w-4" />
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="h-4 w-4" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDirectory && isOpen && entry.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
}

export function FileTree({ files, onFileSelect, selectedFile }: FileTreeProps) {
  return (
    <div className="p-2">
      {files.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
} 