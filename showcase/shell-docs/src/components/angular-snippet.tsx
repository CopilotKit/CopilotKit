import sourceContentData from "@/data/angular-source-content.json";
import { HighlightedDynamicCodeBlock } from "./highlighted-dynamic-codeblock";

interface AngularSourceRegion {
  file: string;
  language: string;
  content: string;
}

const regions = (
  sourceContentData as {
    regions: Record<string, AngularSourceRegion>;
  }
).regions;

/** Render a named region extracted from the canonical Angular Showcase app. */
export function AngularSnippet({
  region,
  noCaption = false,
}: {
  region: string;
  noCaption?: boolean;
}) {
  const source = regions[region];
  if (!source) {
    return (
      <div
        className="shell-docs-radius-surface shell-docs-warning-surface my-4 border border-l-4 p-4 text-sm text-[var(--text-secondary)]"
        role="alert"
      >
        Missing Angular Showcase region <code>{region}</code>.
      </div>
    );
  }

  const filename = source.file.split("/").at(-1);
  return (
    <HighlightedDynamicCodeBlock
      lang={source.language}
      code={source.content}
      codeblock={
        noCaption || !filename
          ? undefined
          : {
              title: filename,
            }
      }
    />
  );
}
