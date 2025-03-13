import React from 'react';
import { DemoConfig } from '@/config/demos';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface DemoListProps {
  demos: DemoConfig[];
  selectedDemo?: string;
  onSelect: (demoId: string) => void;
}

export function DemoList({ demos, selectedDemo, onSelect }: DemoListProps) {
  return (
    <div className="w-64 border-r h-full overflow-auto">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Demos</h2>
      </div>
      <div className="p-2">
        {demos.map((demo) => (
          <button
            key={demo.id}
            className={cn(
              'w-full text-left p-3 rounded-lg mb-2 hover:bg-accent/50 transition-colors',
              'flex flex-col gap-1',
              selectedDemo === demo.id && 'bg-accent'
            )}
            onClick={() => onSelect(demo.id)}
          >
            <div className="font-medium">{demo.name}</div>
            <div className="text-sm text-muted-foreground line-clamp-2">
              {demo.description}
            </div>
            {demo.tags && demo.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {demo.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
} 