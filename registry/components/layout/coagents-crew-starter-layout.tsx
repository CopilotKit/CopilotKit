"use client";
import React from "react";
import { CopilotChat } from "@copilotkit/react-ui";

export default function CoagentsCrewStarterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full h-full relative">
      <div className="flex w-full h-full">
        {/* Chat Column */}
        <div className="w-3/5 h-full overflow-y-auto">
          <CopilotChat
            instructions="You are a helpful assistant that can help me with my tasks."
            className="h-full flex flex-col"
          />
        </div>

        {/* Results Column */}
        <div className="w-2/5 h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 p-3">
          {children}
        </div>
      </div>
    </div>
  );
}
