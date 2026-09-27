<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * CopilotKit's design tokens, rendered live. Names are read from the
 * `[data-copilotkit]` rule in `packages/vue/src/styles/globals.css` as loaded
 * on the page, and every swatch paints `var(--token)` inside a
 * `data-copilotkit` scope, so stylesheet edits and the theme toggle show up
 * here immediately.
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
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
];

type Token = { name: string; value: string };

/** Collects custom properties declared on exactly `[data-copilotkit]`. */
function readTokenNames(): string[] {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.trim() === "[data-copilotkit]"
      ) {
        for (const property of Array.from(rule.style)) {
          if (property.startsWith("--") && !property.startsWith("--tw-")) {
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

const scope = ref<HTMLElement | null>(null);
const tokens = ref<Token[]>([]);
let observer: MutationObserver | null = null;

function read() {
  const element = scope.value;
  if (!element) return;
  const style = getComputedStyle(element);
  tokens.value = readTokenNames().map((name) => ({
    name,
    value: style.getPropertyValue(name).trim(),
  }));
}

onMounted(() => {
  read();
  observer = new MutationObserver(read);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
});
onBeforeUnmount(() => observer?.disconnect());

const isColor = (value: string) =>
  /^(oklch|oklab|lch|lab|rgb|hsl|hwb|color|#)/i.test(value) ||
  /^[a-z]+$/i.test(value);

const byName = computed(
  () => new Map(tokens.value.map((token) => [token.name, token])),
);
const colors = computed(() => tokens.value.filter((t) => isColor(t.value)));

// Surfaces: every token with a `-foreground` partner, plus background/foreground.
const pairs = computed(() =>
  colors.value
    .filter(
      (token) =>
        !token.name.endsWith("-foreground") &&
        token.name !== "--foreground" &&
        (byName.value.has(`${token.name}-foreground`) ||
          token.name === "--background"),
    )
    .map((surface) => ({
      surface,
      text: byName.value.get(
        surface.name === "--background"
          ? "--foreground"
          : `${surface.name}-foreground`,
      ),
    })),
);
const paired = computed(
  () =>
    new Set(
      pairs.value.flatMap(({ surface, text }) => [surface.name, text?.name]),
    ),
);
const charts = computed(() =>
  colors.value.filter((token) => token.name.startsWith("--chart-")),
);
const lines = computed(() =>
  colors.value.filter(
    (token) =>
      !paired.value.has(token.name) &&
      !token.name.startsWith("--chart-") &&
      /(border|input|ring)$/.test(token.name),
  ),
);
const otherColors = computed(() => {
  const listed = new Set([
    ...paired.value,
    ...charts.value.map((token) => token.name),
    ...lines.value.map((token) => token.name),
  ]);
  return colors.value.filter((token) => !listed.has(token.name));
});
const radius = computed(() => byName.value.get("--radius"));

const radii = [
  { label: "sm", css: "calc(var(--radius) - 4px)" },
  { label: "md", css: "calc(var(--radius) - 2px)" },
  { label: "lg", css: "var(--radius)" },
  { label: "xl", css: "calc(var(--radius) + 4px)" },
];

const typeScale = [
  {
    label: "Title",
    style: "font-size: 16px; font-weight: 500; letter-spacing: -0.01em",
    meta: "16px · medium",
  },
  { label: "Body", style: "font-size: 14px", meta: "14px · regular" },
  {
    label: "Secondary",
    style: "font-size: 14px; color: var(--muted-foreground)",
    meta: "14px · muted-foreground",
  },
  {
    label: "Caption",
    style: "font-size: 12px; color: var(--muted-foreground)",
    meta: "12px · muted-foreground",
  },
  {
    label: "Code",
    style: "font-family: var(--story-mono); font-size: 13px",
    meta: "13px · monospace",
  },
];
</script>

<template>
  <div ref="scope" data-copilotkit class="tokens-page">
    <div class="tokens-page__inner">
      <header class="tokens-page__header">
        <p class="tokens-mono tokens-muted">Foundations</p>
        <h1 class="tokens-page__title">Design tokens</h1>
        <p class="tokens-muted">
          Live values of the custom properties CopilotKit defines on
          <code class="tokens-mono tokens-strong">[data-copilotkit]</code> in
          <code class="tokens-mono tokens-strong">styles/globals.css</code>.
          Toggle the theme in the toolbar to see the dark values.
        </p>
      </header>

      <section class="tokens-section">
        <h2>Surfaces and text</h2>
        <p class="tokens-muted">
          Each surface with the foreground color meant to sit on it.
        </p>
        <div class="tokens-grid tokens-grid--4">
          <div
            v-for="{ surface, text } in pairs"
            :key="surface.name"
            class="tokens-swatch"
          >
            <div
              class="tokens-swatch__pair"
              :style="{
                background: `var(${surface.name})`,
                color: text ? `var(${text.name})` : undefined,
              }"
            >
              <span class="tokens-swatch__aa">Aa</span>
              <span v-if="text" style="font-size: 12px">Text on surface</span>
            </div>
            <div class="tokens-swatch__meta">
              <span class="tokens-mono">{{ surface.name }}</span>
              <span class="tokens-value">{{ surface.value }}</span>
              <template v-if="text">
                <span class="tokens-mono" style="padding-top: 4px">{{
                  text.name
                }}</span>
                <span class="tokens-value">{{ text.value }}</span>
              </template>
            </div>
          </div>
        </div>
      </section>

      <section class="tokens-section">
        <h2>Lines and focus</h2>
        <p class="tokens-muted">Borders, input outlines and focus rings.</p>
        <div class="tokens-grid tokens-grid--5">
          <div v-for="token in lines" :key="token.name" class="tokens-swatch">
            <div
              class="tokens-swatch__color"
              :style="{ background: `var(${token.name})` }"
            />
            <div class="tokens-swatch__meta">
              <span class="tokens-mono">{{ token.name }}</span>
              <span class="tokens-value">{{ token.value }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="charts.length > 0" class="tokens-section">
        <h2>Charts</h2>
        <p class="tokens-muted">Categorical series colors.</p>
        <div class="tokens-grid tokens-grid--5">
          <div v-for="token in charts" :key="token.name" class="tokens-swatch">
            <div
              class="tokens-swatch__color"
              :style="{ background: `var(${token.name})` }"
            />
            <div class="tokens-swatch__meta">
              <span class="tokens-mono">{{ token.name }}</span>
              <span class="tokens-value">{{ token.value }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="otherColors.length > 0" class="tokens-section">
        <h2>Other colors</h2>
        <p class="tokens-muted">Tokens without a pairing.</p>
        <div class="tokens-grid tokens-grid--4">
          <div
            v-for="token in otherColors"
            :key="token.name"
            class="tokens-swatch"
          >
            <div
              class="tokens-swatch__color"
              :style="{ background: `var(${token.name})` }"
            />
            <div class="tokens-swatch__meta">
              <span class="tokens-mono">{{ token.name }}</span>
              <span class="tokens-value">{{ token.value }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="tokens-section">
        <h2>Radius</h2>
        <p class="tokens-muted">
          --radius is {{ radius?.value || "unset" }}; the scale steps derive
          from it.
        </p>
        <div class="tokens-grid tokens-grid--4">
          <div v-for="{ label, css } in radii" :key="label">
            <div class="tokens-radius" :style="{ borderRadius: css }" />
            <span class="tokens-mono">radius-{{ label }}</span>
            <span class="tokens-value">{{ css }}</span>
          </div>
        </div>
      </section>

      <section class="tokens-section">
        <h2>Type</h2>
        <p class="tokens-muted">
          The text styles chat components use, in the CopilotKit scope's font.
        </p>
        <div class="tokens-type">
          <div
            v-for="row in typeScale"
            :key="row.label"
            class="tokens-type__row"
          >
            <span class="tokens-muted" style="font-size: 12px">{{
              row.label
            }}</span>
            <span :style="row.style"
              >The quick brown fox jumps over the lazy dog</span
            >
            <span class="tokens-value">{{ row.meta }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tokens-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 48px 40px;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--story-font);
}
.tokens-page__inner {
  max-width: 64rem;
  margin: 0 auto;
}
.tokens-page__header > * + * {
  margin-top: 8px;
}
.tokens-page__header p {
  margin: 0;
  font-size: 14px;
}
.tokens-page__title {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.tokens-section {
  margin-top: 48px;
}
.tokens-section h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.tokens-section > p {
  margin: 4px 0 16px;
  font-size: 14px;
}
.tokens-muted {
  color: var(--muted-foreground);
}
.tokens-strong {
  color: var(--foreground);
}
.tokens-mono {
  display: block;
  font-family: var(--story-mono);
  font-size: 12px;
}
.tokens-page__header .tokens-mono,
.tokens-page__header code {
  display: inline;
}
.tokens-value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--story-mono);
  font-size: 11px;
  color: var(--muted-foreground);
}
.tokens-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 900px) {
  .tokens-grid--4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .tokens-grid--5 {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
.tokens-swatch {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.tokens-swatch__pair {
  display: flex;
  height: 96px;
  align-items: flex-end;
  justify-content: space-between;
  padding: 12px;
}
.tokens-swatch__aa {
  font-size: 24px;
  font-weight: 600;
}
.tokens-swatch__color {
  height: 56px;
}
.tokens-swatch__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--border);
  padding: 12px;
}
.tokens-radius {
  height: 80px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  background: var(--muted);
}
.tokens-type {
  border: 1px solid var(--border);
  border-radius: 12px;
}
.tokens-type__row {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  align-items: baseline;
  gap: 24px;
  padding: 16px 20px;
}
.tokens-type__row + .tokens-type__row {
  border-top: 1px solid var(--border);
}
</style>
