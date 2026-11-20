import path from "node:path";
import ts from "typescript";
import { assert, expect, it } from "vitest";

it.each([
  "./src/index",
  "./src/components",
  "./src/components/copilot-textarea/copilot-textarea",
])("exposes editor deprecation guidance through %s", (entrypoint) => {
  const packageRoot = path.resolve(__dirname, "..");
  const consumerFile = path.join(packageRoot, "deprecation-consumer.tsx");
  const source = `
import { CopilotTextarea, type CopilotTextareaProps } from "${entrypoint}";
CopilotTextarea;
type Props = CopilotTextareaProps;
`;
  const service = ts.createLanguageService({
    ...ts.sys,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCompilationSettings: () => ({
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      types: [],
    }),
    getScriptFileNames: () => [consumerFile],
    getScriptVersion: () => "0",
    getScriptSnapshot: (file) => {
      const text = file === consumerFile ? source : ts.sys.readFile(file);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => packageRoot,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
  });

  try {
    for (const name of ["CopilotTextarea", "CopilotTextareaProps"]) {
      const info = service.getQuickInfoAtPosition(
        consumerFile,
        source.lastIndexOf(`${name};`),
      );
      assert(info, `${entrypoint}: ${name} has no quick info`);
      expect(
        source.slice(
          info.textSpan.start,
          info.textSpan.start + info.textSpan.length,
        ),
      ).toBe(name);
      const tag = info.tags?.find(
        (candidate) => candidate.name === "deprecated",
      );
      expect(tag, `${entrypoint}: ${name}`).toBeDefined();
      const warning = ts.displayPartsToString(tag?.text);
      for (const text of [
        "Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.",
        "No 1:1 v2 replacement is available.",
        "@copilotkit/react-core/v2",
        "https://docs.copilotkit.ai/",
        "https://docs.copilotkit.ai/reference/v2",
        "https://docs.copilotkit.ai/migrate/v2",
      ]) {
        expect(warning).toContain(text);
      }
    }
  } finally {
    service.dispose();
  }
});
