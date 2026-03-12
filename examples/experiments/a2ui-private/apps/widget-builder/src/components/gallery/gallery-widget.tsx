'use client';

import { Widget } from '@/types/widget';
import { A2UIViewer } from '@copilotkitnext/a2ui-renderer';

interface GalleryWidgetProps {
  widget: Widget;
  height?: number;
  onClick?: () => void;
}

export function GalleryWidget({ widget, height = 200, onClick }: GalleryWidgetProps) {
  // Get the first data state's data for preview
  const previewData = widget.dataStates?.[0]?.data ?? {};

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-white bg-white/80 p-4 shadow-sm transition-all hover:shadow-md hover:border-muted-foreground/30 cursor-pointer overflow-hidden"
      style={{ minHeight: height }}
    >
      <div className="flex flex-col gap-2 h-full">
        <span className="text-xs font-medium text-muted-foreground">
          {widget.name}
        </span>
        <div
          className="pointer-events-none flex-1 flex items-center justify-center"
          style={{ '--a2ui-card-bg': 'transparent' } as React.CSSProperties}
        >
          <A2UIViewer
            root={widget.root}
            components={widget.components}
            data={previewData}
          />
        </div>
      </div>
    </button>
  );
}
