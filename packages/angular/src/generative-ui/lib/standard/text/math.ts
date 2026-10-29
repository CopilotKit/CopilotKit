import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import type { KatexOptions } from "katex";

type MathRenderer = (tex: string, options: KatexOptions) => string;

// KaTeX loads in its own chunk the first time a formula renders. Until it
// arrives, the formula shows its TeX source.
let mathRenderer: MathRenderer | undefined;
let mathLoading: Promise<void> | undefined;
const mathListeners = new Set<() => void>();

function loadMathRenderer() {
  if (mathRenderer || typeof window === "undefined") return mathLoading;
  mathLoading ??= import("katex").then((module) => {
    const katex =
      (module as { default?: { renderToString: MathRenderer } }).default ??
      (module as unknown as { renderToString: MathRenderer });
    mathRenderer = katex.renderToString.bind(katex);
    for (const listener of [...mathListeners]) listener();
  });
  return mathLoading;
}

/** Loads KaTeX now. Tests call it before they assert on typeset output. */
export async function preloadMathRenderer(): Promise<void> {
  await loadMathRenderer();
}

/**
 * A TeX formula, typeset with KaTeX. KaTeX escapes the source and adds
 * MathML for screen readers. With `trust: false`, commands that make links
 * or raw HTML do not work. An invalid formula shows as red source text, not
 * as an error. The host is a span; a block formula is a block-level span.
 */
@Component({
  selector: "span[copilotGenerativeUIMath]",
  template: "",
  host: {
    "[attr.data-math]": "block() === true ? 'block' : 'inline'",
    "[style.display]": "block() === true ? 'block' : null",
  },
})
export class CopilotGenerativeUIMath {
  readonly value = input.required<string>();
  readonly block = input<boolean>();

  readonly #ready = signal(0);

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (!mathRenderer) {
      const listener = () => this.#ready.update((n) => n + 1);
      mathListeners.add(listener);
      inject(DestroyRef).onDestroy(() => mathListeners.delete(listener));
      void loadMathRenderer();
    }
    effect(() => {
      this.#ready();
      const render = mathRenderer;
      const value = this.value();
      if (!render) {
        element.textContent = value;
        return;
      }
      element.innerHTML = render(value, {
        displayMode: this.block() === true,
        throwOnError: false,
        trust: false,
      });
    });
  }
}
