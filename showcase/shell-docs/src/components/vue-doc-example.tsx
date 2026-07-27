import { HighlightedDynamicCodeBlock } from "./highlighted-dynamic-codeblock";
import {
  resolveVueDocExample,
  vueDocExampleDiagnostic,
} from "@/lib/vue-doc-examples";

interface VueDocExampleProps {
  file?: string;
  region?: string;
}

export function VueDocExample({ file, region }: VueDocExampleProps) {
  try {
    const example = resolveVueDocExample(file, region);
    const basename = example.file.split("/").pop() ?? example.file;
    return (
      <HighlightedDynamicCodeBlock
        lang={example.language}
        code={example.code}
        codeblock={{ title: basename }}
      />
    );
  } catch (error) {
    return (
      <div
        className="shell-docs-radius-surface shell-docs-warning-surface my-4 border border-l-4 p-4 text-sm text-[var(--text-secondary)]"
        role="alert"
      >
        {vueDocExampleDiagnostic(error)}
      </div>
    );
  }
}
