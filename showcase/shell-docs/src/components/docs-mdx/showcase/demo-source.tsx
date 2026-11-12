// <DemoSource>: a showcase cell's source files, the Code tab of <InlineDemo>.
// A port of shell-docs' src/components/demo-source.tsx.
//
// Shows the files the manifest flags in `highlight:` (in `highlightOrder`),
// or every bundled file when none are flagged or `onlyHighlighted` is false.
// One file renders as a code block; several as Fumadocs' code block tabs, one
// tab per file, on the demo stage like every other code block.

import type { ReactNode } from "react";
import { Callout } from "fumadocs-ui/components/callout";
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from "fumadocs-ui/components/codeblock";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { brandDark, brandLight } from "@/proto/code-theme";
import { DocsCode } from "../code";
import { getDemoRecord, type DemoFile } from "../data";
import { shikiLanguage } from "./snippet";

type SourceFile = DemoFile & { highlightOrder?: number };

function selectFiles(all: SourceFile[], onlyHighlighted: boolean) {
  if (!onlyHighlighted) return all;
  const flagged = all.filter((f) => f.highlighted);
  if (!flagged.length) return all;
  return flagged.sort((a, b) => {
    const ao = a.highlightOrder;
    const bo = b.highlightOrder;
    if (ao === undefined && bo === undefined) {
      return a.filename.localeCompare(b.filename);
    }
    if (ao === undefined) return 1;
    if (bo === undefined) return -1;
    return ao - bo;
  });
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** A file's code block body for a tab; unknown languages read as plain text. */
async function TabCode({
  file,
  className,
}: {
  file: SourceFile;
  /** Set for a lone file, which gets a code block of its own. */
  className?: string;
}) {
  const code = file.content.replace(/\n$/, "");
  const block = (lang: string) =>
    ServerCodeBlock({
      code,
      lang,
      themes: { light: brandLight, dark: brandDark },
      ...(className
        ? { codeblock: { title: basename(file.filename), className } }
        : {}),
    });
  let rendered: ReactNode;
  try {
    rendered = await block(shikiLanguage(file.language));
  } catch {
    rendered = await block("plaintext");
  }
  return rendered;
}

function MissingSource({ children }: { children: ReactNode }) {
  return (
    <Callout type="warn" title="Missing demo source" role="alert">
      {children}
    </Callout>
  );
}

export function DemoSource({
  integration,
  demo,
  onlyHighlighted = true,
  bare = false,
  className,
}: {
  /**
   * Fill a demo window (DemoFrame's Code view): no stage, no frame of its
   * own, flush to the window.
   */
  bare?: boolean;
  /** Integration slug, e.g. `langgraph-python`. */
  integration: string;
  /** Demo id, e.g. `agentic-chat`. */
  demo: string;
  /** Only the manifest's highlighted files (all files when none are). */
  onlyHighlighted?: boolean;
  className?: string;
}) {
  const key = `${integration}::${demo}`;
  const record = getDemoRecord(integration, demo);
  if (!record) {
    return (
      <MissingSource>
        No demo found for <code>{key}</code>. Check the integration slug and
        demo id.
      </MissingSource>
    );
  }
  const files = selectFiles(
    [...((record.files ?? []) as SourceFile[])],
    onlyHighlighted,
  );
  if (!files.length) {
    return (
      <MissingSource>
        Demo <code>{key}</code> has no bundled source files.
      </MissingSource>
    );
  }

  if (bare) {
    const flush = "my-0 rounded-none border-0 bg-transparent shadow-none";
    if (files.length === 1)
      return <TabCode file={files[0]} className={flush} />;
    return (
      <CodeBlockTabs defaultValue={files[0].filename} className={flush}>
        <CodeBlockTabsList>
          {files.map((f) => (
            <CodeBlockTabsTrigger
              key={f.filename}
              value={f.filename}
              title={f.filename}
            >
              {basename(f.filename)}
            </CodeBlockTabsTrigger>
          ))}
        </CodeBlockTabsList>
        {files.map((f) => (
          <CodeBlockTab key={f.filename} value={f.filename}>
            <TabCode file={f} />
          </CodeBlockTab>
        ))}
      </CodeBlockTabs>
    );
  }

  if (files.length === 1) {
    const [file] = files;
    return (
      <DocsCode
        code={file.content}
        lang={shikiLanguage(file.language)}
        title={basename(file.filename)}
        className={className}
      />
    );
  }

  return (
    <Stage className={className ?? "my-6"}>
      <CodeBlockTabs
        defaultValue={files[0].filename}
        className={`my-0 overflow-hidden ${STAGE_WINDOW}`}
      >
        <CodeBlockTabsList>
          {files.map((f) => (
            <CodeBlockTabsTrigger
              key={f.filename}
              value={f.filename}
              title={f.filename}
            >
              {basename(f.filename)}
            </CodeBlockTabsTrigger>
          ))}
        </CodeBlockTabsList>
        {files.map((f) => (
          <CodeBlockTab key={f.filename} value={f.filename}>
            <TabCode file={f} />
          </CodeBlockTab>
        ))}
      </CodeBlockTabs>
    </Stage>
  );
}
