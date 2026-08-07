"use client";

/**
 * Card rendered for `repo_read_file` tool calls. The fixture-file read is
 * implemented as a live wrapper (Next.js → agent → host fs) and is therefore
 * tagged with `<PrimitiveWrapperBadge />`.
 */

import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import {
  CodeBlock,
  languageFromPath,
} from "@/components/control-room/renderers/CodeBlock";

interface FileReadCardProps {
  args?: { relative_path?: string };
  status?: string;
  result?: { path: string; content: string };
}

export function FileReadCard({ args, status, result }: FileReadCardProps) {
  const path = result?.path ?? args?.relative_path ?? "(unknown path)";
  const content = result?.content ?? "";
  const isComplete = status === "complete";

  return (
    <div className="cr-tool-card">
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">File · {path}</h3>
        <PrimitiveWrapperBadge />
      </header>
      {!isComplete && !result ? (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Reading file…
        </p>
      ) : content ? (
        <CodeBlock
          code={content}
          language={languageFromPath(path)}
          maxHeight={320}
        />
      ) : (
        <p
          className="text-[10.5px] italic uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          (empty file)
        </p>
      )}
    </div>
  );
}
