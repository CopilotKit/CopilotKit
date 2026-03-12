'use client';

import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { A2UIViewer, type ComponentInstance } from '@copilotkitnext/a2ui-renderer';

interface PreviewPaneProps {
  root: string;
  components: ComponentInstance[];
  data: Record<string, unknown>;
}

export function PreviewPane({ root, components, data }: PreviewPaneProps) {
  const [isDark, setIsDark] = useState(false);

  return (
    <div className={`flex h-full flex-col border-l border-border ${isDark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
      <div className="flex justify-end p-2">
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-lg ${isDark ? 'bg-neutral-800 hover:bg-neutral-700' : 'bg-white hover:bg-neutral-100 border border-neutral-200'}`}
          onClick={() => setIsDark(!isDark)}
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-neutral-400" />
          ) : (
            <Moon className="h-4 w-4 text-neutral-400" />
          )}
        </Button>
      </div>
      <div className="flex flex-1 items-start justify-center p-8 overflow-auto">
        <A2UIViewer
          root={root}
          components={components}
          data={data}
          onAction={(action) => console.log('Widget action:', action)}
        />
      </div>
    </div>
  );
}
