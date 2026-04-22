import React from "react";

interface Props {
  workspaceRoot: string | null;
}

export function EmptyState({ workspaceRoot }: Props) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6 text-[var(--vscode-descriptionForeground)]">
      <div className="text-[13px] text-[var(--vscode-foreground)]">
        No CopilotKit hooks found
      </div>
      <div className="text-[12px] leading-relaxed">
        {workspaceRoot
          ? "Add a call to a CopilotKit hook (e.g. useCopilotAction, useCopilotReadable) from @copilotkit/react-core and save the file."
          : "Open a folder to start discovering CopilotKit hooks."}
      </div>
    </div>
  );
}
