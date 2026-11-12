// <AngularSnippet>: a named region of the canonical Angular showcase app, for
// the Angular docs. A port of shell-docs' angular-snippet.tsx.

import { Callout } from "fumadocs-ui/components/callout";
import { DocsCode } from "../code";
import { getAngularSourceRegion } from "../data";

export function AngularSnippet({
  region,
  noCaption = false,
}: {
  region: string;
  noCaption?: boolean;
}) {
  const source = getAngularSourceRegion(region);
  if (!source) {
    return (
      <Callout type="warn" role="alert">
        Missing Angular showcase region <code>{region}</code>.
      </Callout>
    );
  }
  const filename = source.file.split("/").at(-1);
  return (
    <DocsCode
      code={source.content}
      lang={source.language}
      title={noCaption ? undefined : filename}
    />
  );
}
