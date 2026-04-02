"use client";

import { ReactNode } from "react";

interface ExampleLayoutProps {
  chatContent: ReactNode;
}

export function ExampleLayout({ chatContent }: ExampleLayoutProps) {
  return (
    <div className="h-full flex flex-row">
      <div className="max-h-full overflow-y-auto flex-1 max-lg:px-4">
        {chatContent}
      </div>
    </div>
  );
}
