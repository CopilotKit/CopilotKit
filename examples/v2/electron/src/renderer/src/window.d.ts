// Ambient global augmentation (no top-level import/export, so this file stays a
// script and merges into the global `Window` — and the lint-fix hook has no
// `export {}` to strip, which previously broke this declaration).
interface Window {
  electron: {
    runtime: { getUrl: () => Promise<string | null> };
  };
}
