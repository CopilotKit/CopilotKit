"use client";

import { ReactNode, useState } from "react";
import { ModeToggle } from "./mode-toggle";
import { useFrontendTool } from "@copilotkit/react-core";

interface ExampleLayoutProps {
  chatContent: ReactNode;
  appContent: ReactNode;
}

export function ExampleLayout({
  chatContent,
  appContent,
}: ExampleLayoutProps) {
  const [mode, setMode] = useState<'chat' | 'app'>('chat');

  useFrontendTool({
    name: "enableAppMode",
    description: "Enable app mode, make sure its open when interacting with todos.",
    handler: async () => {
      setMode('app');
    },
  });

  useFrontendTool({
    name: "enableChatMode",
    description: "Enable chat mode",
    handler: async () => {
      setMode('chat');
    },
  });

  return (
    <div className="h-full flex flex-row">
      <ModeToggle mode={mode} onModeChange={setMode} />

      {/* Chat Content */}
      <div
        className={`max-h-full overflow-y-auto ${
          mode === 'app'
            ? 'w-1/3 px-6 max-lg:hidden' // Hide on mobile in app mode
            : 'flex-1 max-lg:px-4'
        }`}
      >
        {chatContent}
      </div>

      {/* State Panel */}
      <div
        className={`h-full overflow-hidden ${
          mode === 'app'
            ? 'w-2/3 max-lg:w-full border-l border-zinc-200 dark:border-zinc-700 max-lg:border-l-0' // Full width on mobile
            : 'w-0 border-l-0'
        }`}
      >
        <div className="w-full lg:w-[66.666vw] h-full">
          {appContent}
        </div>
      </div>
    </div>
  );
}
