export function EmptyCatalogState({
  workspaceRoot,
}: {
  workspaceRoot: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-6 text-[12px] text-[var(--vscode-descriptionForeground)]">
      <div className="font-medium text-[var(--vscode-foreground)]">
        No catalogs found
      </div>
      <div>
        Looked for files that import{" "}
        <code className="rounded bg-[var(--vscode-textCodeBlock-background)] px-1 py-0.5 font-mono text-[11px]">
          @copilotkit/a2ui-renderer
        </code>{" "}
        or call{" "}
        <code className="rounded bg-[var(--vscode-textCodeBlock-background)] px-1 py-0.5 font-mono text-[11px]">
          createCatalog(...)
        </code>
        .
      </div>
      {workspaceRoot ? (
        <div className="truncate">
          Workspace:{" "}
          <code className="font-mono text-[11px]">{workspaceRoot}</code>
        </div>
      ) : (
        <div>Open a workspace folder to scan for catalogs.</div>
      )}
    </div>
  );
}
