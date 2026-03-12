'use client';

import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DataState } from '@/types/widget';

interface DataPanelProps {
  dataStates: DataState[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onAddState: () => void;
  onUpdateState: (index: number, data: Record<string, unknown>) => void;
  onRenameState: (index: number, name: string) => void;
  onDeleteState: (index: number) => void;
}

export function DataPanel({
  dataStates,
  activeIndex,
  onActiveIndexChange,
  onAddState,
  onUpdateState,
  onRenameState,
  onDeleteState,
}: DataPanelProps) {
  const activeState = dataStates[activeIndex];
  const [jsonValue, setJsonValue] = useState(() =>
    JSON.stringify(activeState?.data ?? {}, null, 2)
  );

  // Update editor when active state changes
  useEffect(() => {
    setJsonValue(JSON.stringify(activeState?.data ?? {}, null, 2));
  }, [activeIndex, activeState]);

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      setJsonValue(value);
      try {
        const parsed = JSON.parse(value);
        onUpdateState(activeIndex, parsed);
      } catch {
        // Invalid JSON, don't update
      }
    }
  };

  const handleTabDoubleClick = (index: number) => {
    const newName = prompt('Rename state:', dataStates[index].name);
    if (newName && newName.trim()) {
      onRenameState(index, newName.trim());
    }
  };

  return (
    <div className="flex h-full flex-col border-t border-border bg-background">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 overflow-x-auto flex-shrink-0">
        {dataStates.map((state, index) => (
          <div
            key={index}
            className={cn(
              'group flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap',
              activeIndex === index
                ? 'text-foreground bg-background rounded-t-md border-x border-t border-border -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onActiveIndexChange(index)}
            onDoubleClick={() => handleTabDoubleClick(index)}
          >
            <span>{state.name}</span>
            {dataStates.length > 1 && index !== 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteState(index);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground cursor-pointer flex-shrink-0"
          onClick={onAddState}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* JSON Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          value={jsonValue}
          language="json"
          defaultLanguage="json"
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            padding: { top: 8, bottom: 8 },
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
            },
          }}
        />
      </div>
    </div>
  );
}
