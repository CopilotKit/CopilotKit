'use client';

import React, { Suspense } from 'react';
import { DemoConfig } from '@/types/demo';

export function DemoPreview({ demo }: { demo: DemoConfig }) {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    demo.component()
      .then(comp => setComponent(() => comp))
      .catch(err => {
        console.error('Error loading demo:', err);
        setError('Failed to load demo component');
      });
  }, [demo]);

  if (error) {
    return (
      <div className="p-6 text-center text-red-500">
        {error}
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Loading demo...
      </div>
    );
  }

  return (
    <div className="p-4 h-full">
      <Suspense fallback={
        <div className="p-6 text-center text-muted-foreground">
          Loading...
        </div>
      }>
        <Component />
      </Suspense>
    </div>
  );
} 