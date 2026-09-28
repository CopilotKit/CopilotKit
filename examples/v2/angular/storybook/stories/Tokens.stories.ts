import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";

/**
 * CopilotKit's design tokens, rendered live. Names are read from the
 * `[data-copilotkit]` rule in `packages/angular/src/styles/globals.css` as
 * loaded on the page, and every swatch paints `var(--token)` inside a
 * `data-copilotkit` scope, so stylesheet edits and the theme toggle show up
 * immediately. Mirrors the React Storybook's Foundations/Tokens.
 */

/** Token names as of writing; used only if the live stylesheet can't be read. */
const FALLBACK_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--radius",
];

/**
 * The token rule: `[data-copilotkit]`, optionally narrowed to the outermost
 * root with `:where(...)` (the dark rule has a `.dark` part, so it's skipped).
 */
const TOKEN_ROOT_SELECTOR = /^\[data-copilotkit\](?::where\(.*\))?$/;

/** Collects custom properties declared on the `[data-copilotkit]` token root. */
function readTokenNames(): string[] {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        TOKEN_ROOT_SELECTOR.test(rule.selectorText.trim())
      ) {
        for (const property of Array.from(rule.style)) {
          if (
            property.startsWith("--") &&
            !property.startsWith("--tw-") &&
            !property.startsWith("--copilot-kit-")
          ) {
            names.add(property);
          }
        }
      }
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Cross-origin sheets can't be read; they hold no CopilotKit tokens.
    }
  }
  return names.size > 0 ? [...names] : FALLBACK_TOKENS;
}

const isColor = (value: string) =>
  /^(oklch|oklab|lch|lab|rgb|hsl|hwb|color|#)/i.test(value) ||
  /^[a-z]+$/i.test(value);

interface Token {
  name: string;
  value: string;
}

@Component({
  selector: "story-tokens-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "data-copilotkit": "" },
  template: `
    <div class="page">
      <header>
        <p class="eyebrow">Foundations</p>
        <h1>Design tokens</h1>
        <p class="lede">
          Live values of the custom properties CopilotKit defines on
          <code>[data-copilotkit]</code> in
          <code>packages/angular/src/styles/globals.css</code>. Toggle the theme to
          see the dark values.
        </p>
      </header>

      <section>
        <h2>Surfaces</h2>
        <p class="lede">Each surface with the text color meant to sit on it.</p>
        <div class="grid">
          @for (pair of pairs(); track pair.surface.name) {
            <div class="swatch">
              <div
                class="pair"
                [style.background]="'var(' + pair.surface.name + ')'"
                [style.color]="pair.text ? 'var(' + pair.text.name + ')' : null"
              >
                <span class="aa">Aa</span>
                @if (pair.text) {
                  <span class="caption">Text on surface</span>
                }
              </div>
              <div class="meta">
                <span class="name">{{ pair.surface.name }}</span>
                <span class="value">{{ pair.surface.value }}</span>
                @if (pair.text) {
                  <span class="name">{{ pair.text.name }}</span>
                  <span class="value">{{ pair.text.value }}</span>
                }
              </div>
            </div>
          }
        </div>
      </section>

      <section>
        <h2>Lines and other colors</h2>
        <p class="lede">Borders, inputs, focus rings, charts and the rest.</p>
        <div class="grid">
          @for (token of otherColors(); track token.name) {
            <div class="swatch">
              <div
                class="chip"
                [style.background]="'var(' + token.name + ')'"
              ></div>
              <div class="meta">
                <span class="name">{{ token.name }}</span>
                <span class="value">{{ token.value }}</span>
              </div>
            </div>
          }
        </div>
      </section>

      <section>
        <h2>Radius</h2>
        <p class="lede">
          <code>--radius</code> = {{ radius() }}, and the steps derived from it.
        </p>
        <div class="radii">
          @for (step of radii; track step.label) {
            <div class="radius-step">
              <div class="radius-box" [style.border-radius]="step.css"></div>
              <span class="name">{{ step.label }}</span>
              <span class="value">{{ step.css }}</span>
            </div>
          }
        </div>
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--background);
      color: var(--foreground);
    }
    .page {
      max-width: 64rem;
      margin: 0 auto;
      padding: 3rem 2.5rem;
      display: grid;
      gap: 3rem;
    }
    .eyebrow {
      margin: 0 0 0.5rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted-foreground);
    }
    h1 {
      margin: 0;
      font-size: 1.875rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .lede {
      margin: 0.25rem 0 0;
      max-width: 42rem;
      font-size: 0.875rem;
      color: var(--muted-foreground);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--foreground);
    }
    section {
      display: grid;
      gap: 1rem;
    }
    .grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    }
    .swatch {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
    }
    .pair {
      display: flex;
      height: 6rem;
      align-items: flex-end;
      justify-content: space-between;
      padding: 0.75rem;
    }
    .aa {
      font-size: 1.5rem;
      font-weight: 600;
    }
    .caption {
      font-size: 0.75rem;
    }
    .chip {
      height: 3.5rem;
    }
    .meta {
      display: grid;
      gap: 0.25rem;
      padding: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .name {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
    }
    .value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: var(--muted-foreground);
    }
    .radii {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
    }
    .radius-step {
      display: grid;
      gap: 0.25rem;
      justify-items: start;
    }
    .radius-box {
      width: 5rem;
      height: 5rem;
      border: 1px solid var(--border);
      background: var(--muted);
    }
  `,
})
class StoryTokensPage {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tokens = signal<Token[]>([]);

  protected readonly radii = [
    { label: "sm", css: "calc(var(--radius) - 4px)" },
    { label: "md", css: "calc(var(--radius) - 2px)" },
    { label: "lg", css: "var(--radius)" },
    { label: "xl", css: "calc(var(--radius) + 4px)" },
  ];

  protected readonly pairs = computed(() => {
    const tokens = this.tokens();
    const byName = new Map(tokens.map((t) => [t.name, t]));
    return tokens
      .filter(
        (t) =>
          isColor(t.value) &&
          !t.name.endsWith("-foreground") &&
          t.name !== "--foreground" &&
          (byName.has(`${t.name}-foreground`) || t.name === "--background"),
      )
      .map((surface) => ({
        surface,
        text: byName.get(
          surface.name === "--background"
            ? "--foreground"
            : `${surface.name}-foreground`,
        ),
      }));
  });

  protected readonly otherColors = computed(() => {
    const paired = new Set(
      this.pairs().flatMap(({ surface, text }) => [surface.name, text?.name]),
    );
    return this.tokens().filter((t) => isColor(t.value) && !paired.has(t.name));
  });

  protected readonly radius = computed(
    () => this.tokens().find((t) => t.name === "--radius")?.value ?? "",
  );

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const read = () => {
      const style = getComputedStyle(this.host.nativeElement);
      this.tokens.set(
        readTokenNames().map((name) => ({
          name,
          value: style.getPropertyValue(name).trim(),
        })),
      );
    };
    afterNextRender(() => {
      read();
      const observer = new MutationObserver(read);
      observer.observe(document.documentElement, {
        attributeFilter: ["class"],
      });
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

const meta: Meta = {
  title: "Foundations/Tokens",
  decorators: [moduleMetadata({ imports: [StoryTokensPage] })],
  parameters: { layout: "fullscreen", copilotkit: false },
  render: () => ({ template: `<story-tokens-page />` }),
};

export default meta;
type Story = StoryObj;

export const Tokens: Story = {};
