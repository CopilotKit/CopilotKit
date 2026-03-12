'use client';

import { Sparkles } from 'lucide-react';

export function SidebarHeader() {
  return (
    <div className="flex w-full items-center gap-2 px-2 py-1.5">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <span className="flex-1 text-left text-sm font-semibold tracking-wide uppercase bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">A2UI Composer</span>
    </div>
  );
}
