'use client';

import { use } from 'react';
import { WidgetEditor } from '@/components/editor/widget-editor';
import { useWidgets } from '@/contexts/widgets-context';

interface WidgetPageProps {
  params: Promise<{ id: string }>;
}

export default function WidgetPage({ params }: WidgetPageProps) {
  const { id } = use(params);
  const { loading, getWidget } = useWidgets();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const widget = getWidget(id);

  if (!widget) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">Widget not found</div>
      </div>
    );
  }

  return <WidgetEditor widget={widget} />;
}
