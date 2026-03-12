'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GalleryWidget } from '@/components/gallery/gallery-widget';
import { WidgetPreviewModal } from '@/components/gallery/widget-preview-modal';
import { Widget } from '@/types/widget';
import { useWidgets } from '@/contexts/widgets-context';
import { ALL_GALLERY_WIDGETS } from '@/data/gallery';

export default function GalleryPage() {
  const [selectedWidget, setSelectedWidget] = useState<Widget | null>(null);
  const { addWidget } = useWidgets();
  const router = useRouter();

  const handleOpenInEditor = async () => {
    if (!selectedWidget) return;

    // Create a new widget with a unique ID but copy the content
    const newWidget: Widget = {
      ...selectedWidget,
      id: crypto.randomUUID(),
      name: `${selectedWidget.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to storage
    await addWidget(newWidget);

    // Close modal and navigate to editor
    setSelectedWidget(null);
    router.push(`/widget/${newWidget.id}`);
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="mb-6 text-2xl font-semibold">Gallery</h1>
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5" style={{ columnWidth: '308px' }}>
        {ALL_GALLERY_WIDGETS.map((item) => (
          <div key={item.widget.id} className="mb-4 break-inside-avoid">
            <GalleryWidget
              widget={item.widget}
              height={item.height}
              onClick={() => setSelectedWidget(item.widget)}
            />
          </div>
        ))}
      </div>

      {selectedWidget && (
        <WidgetPreviewModal
          widget={selectedWidget}
          onClose={() => setSelectedWidget(null)}
          onOpenInEditor={handleOpenInEditor}
        />
      )}
    </div>
  );
}
