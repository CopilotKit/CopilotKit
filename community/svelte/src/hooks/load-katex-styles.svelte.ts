let injected = false;

export function loadKatexStyles(): void {
  $effect(() => {
    if (injected || typeof document === "undefined") return;
    injected = true;
    void import("katex/dist/katex.min.css").catch(() => {
      console.warn(
        "[CopilotKit] Failed to load katex styles — math content may render without formatting",
      );
    });
  });
}
