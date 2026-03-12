'use client';

import { useEffect } from 'react';
import { X, RotateCcw, ExternalLink } from 'lucide-react';
import { Widget } from '@/types/widget';
import { Button } from '@/components/ui/button';
import { A2UIViewer } from '@copilotkitnext/a2ui-renderer';
import Editor from '@monaco-editor/react';

interface WidgetPreviewModalProps {
  widget: Widget;
  onClose: () => void;
  onOpenInEditor?: () => void;
}

export function WidgetPreviewModal({ widget, onClose, onOpenInEditor }: WidgetPreviewModalProps) {
  // Get the actual A2UI JSON
  const componentsJson = JSON.stringify(widget.components, null, 2);
  const dataJson = JSON.stringify(widget.dataStates?.[0]?.data ?? {}, null, 2);

  // Get the first data state's data for preview
  const previewData = widget.dataStates?.[0]?.data ?? {};

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex h-[80vh] w-[90vw] max-w-5xl overflow-hidden rounded-2xl bg-neutral-100 shadow-2xl">
        {/* Left side - Preview */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-white px-4 h-10 shrink-0">
            <button
              className="p-1 rounded-md hover:bg-muted"
              title="Reset preview"
            >
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">{widget.name}</span>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-6 text-xs px-2"
              onClick={onOpenInEditor}
            >
              <ExternalLink className="h-3 w-3" />
              Open in widget editor
            </Button>
          </div>

          {/* Preview area */}
          <div className="flex flex-1 items-center justify-center p-8 bg-muted/30">
            <A2UIViewer
              root={widget.root}
              components={widget.components}
              data={previewData}
            />
          </div>
        </div>

        {/* Right side - Code */}
        <div className="w-1/2 border-l border-border flex flex-col">
          {/* Header for Components */}
          <div className="flex items-center border-b border-border bg-white px-4 h-10 shrink-0">
            <span className="text-xs font-medium text-muted-foreground">Components</span>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-muted"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Components section */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                language="json"
                value={componentsJson}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  fontSize: 12,
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
                theme="vs"
              />
            </div>
          </div>

          {/* Data section */}
          <div className="h-1/3 flex flex-col border-t border-border">
            <div className="px-4 py-1.5 bg-white border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground">Data</span>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                language="json"
                value={dataJson}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  fontSize: 12,
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
                theme="vs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
