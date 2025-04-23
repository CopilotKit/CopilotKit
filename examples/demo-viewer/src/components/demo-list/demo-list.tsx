import React, { useRef, useEffect } from 'react';
import { DemoConfig } from '@/types/demo';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface DemoListProps {
  demos: DemoConfig[];
  selectedDemo?: string;
  onSelect: (demoId: string) => void;
  llmSelector?: React.ReactNode;
}

export function DemoList({ demos, selectedDemo, onSelect }: DemoListProps) {
  const features = demos.filter(demo => !demo.iframeUrl);
  const externalDemos = demos.filter(demo => demo.iframeUrl);

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const RESEARCH_CANVAS_ID = 'research-canvas'; // Define constant locally

  useEffect(() => {
    if (selectedDemo && itemRefs.current[selectedDemo]) {
      const scrollBehavior = selectedDemo === RESEARCH_CANVAS_ID ? 'auto' : 'smooth';
      itemRefs.current[selectedDemo]?.scrollIntoView({
        behavior: scrollBehavior, // Use conditional behavior
        block: 'nearest',
      });
    }
  }, [selectedDemo, demos]);

  const renderListSection = (title: string, demoList: DemoConfig[], isExternal: boolean) => {
    if (demoList.length === 0) return null;

    return (
      <>
        <div className={`px-4 pt-3 pb-2 ${isExternal ? 'mt-4 border-t' : ''}`}>
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            {title}
          </h2>
        </div>
        <ul className="px-2 space-y-0.5">
          {demoList.map((demo) => {
            return (
              <li
                key={demo.id}
                ref={(el) => {
                  itemRefs.current[demo.id] = el;
                }}
              >
                <button
                  className={cn(
                    'w-full text-left py-2 px-3 rounded-md hover:bg-accent/50 transition-colors',
                    'flex flex-col gap-0.5',
                    selectedDemo === demo.id && 'bg-accent'
                  )}
                  onClick={() => onSelect(demo.id)}
                  aria-current={selectedDemo === demo.id ? 'page' : undefined}
                >
                  <div className="text-sm font-medium leading-tight">{demo.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {demo.description}
                  </div>
                  {demo.tags && demo.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {demo.tags.map((tag) => (
                        <Badge 
                          key={tag} 
                          variant={selectedDemo === demo.id ? "default" : "secondary"} 
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded-full",
                            selectedDemo === demo.id && "bg-primary text-primary-foreground border-transparent"
                          )}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  return (
    <div className="h-full">
      {renderListSection('Features', features, false)}
      {renderListSection('Demos', externalDemos, true)}
    </div>
  );
} 