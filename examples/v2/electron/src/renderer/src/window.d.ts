// Ambient global augmentation (no top-level import/export, so this file stays a
// script and merges into the global `Window` — and the lint-fix hook has no
// `export {}` to strip, which previously broke this declaration).
interface Window {
  electron: {
    runtime: { getUrl: () => Promise<string | null> };
    workspace: { getRoot: () => Promise<string> };
    fs: {
      write: (
        path: string,
        content: string,
      ) => Promise<{ ok: true; path: string }>;
    };
    shell: {
      run: (
        command: string,
        args: string[],
      ) => Promise<{
        ok: true;
        command: string;
        stdout: string;
        stderr: string;
        exitCode: number;
      }>;
    };
  };
}
