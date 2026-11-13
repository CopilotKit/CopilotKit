let injected = false;

export function loadKatexStyles(): void {
  $effect(() => {
    if (injected || typeof document === "undefined") return;
    injected = true;
    const katexStylesSpecifier = "katex/dist/katex.min.css";
    void import(/* @vite-ignore */ katexStylesSpecifier).catch(() => {
      console.warn(
        "[CopilotKit] Failed to load katex styles — math content may render without formatting",
      );
    });
  });
}
