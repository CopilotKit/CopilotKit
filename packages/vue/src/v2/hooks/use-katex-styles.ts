import { onMounted } from "vue";

// Module-level singleton flag so the stylesheet is only injected once per
// module graph (matches the React singleton injection intent).
let injected = false;

/**
 * Dynamically loads KaTeX CSS at runtime to avoid Next.js-style
 * "Global CSS cannot be imported from within node_modules" build errors and
 * to keep the CSS out of the static import graph.
 *
 * Uses a module-level singleton flag so the stylesheet is only loaded once,
 * regardless of how many components call this composable.
 *
 * Mirrors the React `useKatexStyles` hook: returns `void`, never throws, and
 * logs a warning with equivalent intent if the dynamic import fails.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useKatexStyles } from "@copilotkit/vue";
 *
 * useKatexStyles();
 * </script>
 * ```
 */
export function useKatexStyles(): void {
  onMounted(() => {
    if (injected || typeof document === "undefined") return;
    injected = true;

    // Dynamic import defers CSS loading to runtime, bypassing build-time
    // static analysis that rejects global CSS from node_modules.
    // The `@vite-ignore` + indirect specifier keeps TypeScript from trying
    // to resolve a type declaration for the CSS module while still letting
    // the bundler handle the actual side-effect import at runtime.
    const katexStylesSpecifier = "katex/dist/katex.min.css";
    void import(/* @vite-ignore */ katexStylesSpecifier).catch(() => {
      console.warn(
        "[CopilotKit] Failed to load katex styles — math content may render without formatting",
      );
    });
  });
}
