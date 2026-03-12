'use client';

import Editor, { type Monaco } from '@monaco-editor/react';

interface CodeEditorProps {
  value: string;
  onChange?: (code: string) => void;
}

export function CodeEditor({ value, onChange }: CodeEditorProps) {
  const handleBeforeMount = (monaco: Monaco) => {
    // Disable all TypeScript/JavaScript diagnostics
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });

    // Define custom theme with background line highlight instead of border
    monaco.editor.defineTheme('custom-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.lineHighlightBackground': '#f5f5f5',
        'editor.lineHighlightBorder': '#00000000', // transparent
      },
    });
  };

  return (
    <div className="h-full w-full">
      <Editor
        value={value}
        defaultLanguage="json"
        theme="custom-light"
        onChange={(value) => onChange?.(value ?? '')}
        beforeMount={handleBeforeMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          cursorStyle: 'line',
          renderLineHighlight: 'all',
          renderLineHighlightOnlyWhenFocus: false,
          guides: {
            indentation: false,
            bracketPairs: false,
            highlightActiveIndentation: false,
          },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'hidden',
          },
        }}
      />
    </div>
  );
}
