import React, { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * CopilotKit's design tokens, rendered live. Names are read from the
 * `[data-copilotkit]` rule in `packages/react-core/src/v2/styles/globals.css`
 * as loaded on the page, and every swatch paints `var(--token)` inside a
 * `data-copilotkit` scope, so edits to the stylesheet and the theme toggle
 * show up here immediately.
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

/** Token names plus their resolved values, refreshed on theme or style changes. */
function useTokens(scope: React.RefObject<HTMLElement | null>) {
  const [tokens, setTokens] = useState<{ name: string; value: string }[]>([]);

  useEffect(() => {
    const read = () => {
      const element = scope.current;
      if (!element) return;
      const style = getComputedStyle(element);
      setTokens(
        readTokenNames().map((name) => ({
          name,
          value: style.getPropertyValue(name).trim(),
        })),
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [scope]);

  return tokens;
}

const isColor = (value: string) =>
  /^(oklch|oklab|lch|lab|rgb|hsl|hwb|color|#)/i.test(value) ||
  /^[a-z]+$/i.test(value);

const Section: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    {children}
  </section>
);

const Value: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="block truncate font-mono text-[11px] text-muted-foreground">
    {children}
  </span>
);

const PairSwatch: React.FC<{
  surface: { name: string; value: string };
  text?: { name: string; value: string };
}> = ({ surface, text }) => (
  <div className="overflow-hidden rounded-xl border border-border">
    <div
      className="flex h-24 items-end justify-between p-3"
      style={{
        background: `var(${surface.name})`,
        color: text ? `var(${text.name})` : undefined,
      }}
    >
      <span className="text-2xl font-semibold tracking-tight">Aa</span>
      {text && <span className="text-xs">Text on surface</span>}
    </div>
    <div className="space-y-1 border-t border-border p-3">
      <span className="block font-mono text-xs">{surface.name}</span>
      <Value>{surface.value}</Value>
      {text && (
        <>
          <span className="block pt-1 font-mono text-xs">{text.name}</span>
          <Value>{text.value}</Value>
        </>
      )}
    </div>
  </div>
);

const ColorSwatch: React.FC<{ name: string; value: string }> = ({
  name,
  value,
}) => (
  <div className="overflow-hidden rounded-xl border border-border">
    <div className="h-14" style={{ background: `var(${name})` }} />
    <div className="space-y-1 border-t border-border p-3">
      <span className="block font-mono text-xs">{name}</span>
      <Value>{value}</Value>
    </div>
  </div>
);

const radii = [
  { label: "sm", css: "calc(var(--radius) - 4px)" },
  { label: "md", css: "calc(var(--radius) - 2px)" },
  { label: "lg", css: "var(--radius)" },
  { label: "xl", css: "calc(var(--radius) + 4px)" },
];

const typeScale = [
  {
    label: "Title",
    className: "text-base font-medium tracking-tight",
    meta: "16px · medium",
  },
  { label: "Body", className: "text-sm", meta: "14px · regular" },
  {
    label: "Secondary",
    className: "text-sm text-muted-foreground",
    meta: "14px · muted-foreground",
  },
  {
    label: "Caption",
    className: "text-xs text-muted-foreground",
    meta: "12px · muted-foreground",
  },
  {
    label: "Code",
    className: "font-mono text-[13px]",
    meta: "13px · monospace",
  },
];

const TokensPage: React.FC = () => {
  const scope = useRef<HTMLDivElement>(null);
  const tokens = useTokens(scope);
  const byName = new Map(tokens.map((token) => [token.name, token]));
  const colors = tokens.filter((token) => isColor(token.value));

  // Surfaces: every token with a `-foreground` partner, plus background/foreground.
  const pairs = colors
    .filter(
      (token) =>
        !token.name.endsWith("-foreground") &&
        token.name !== "--foreground" &&
        (byName.has(`${token.name}-foreground`) ||
          token.name === "--background"),
    )
    .map((surface) => ({
      surface,
      text: byName.get(
        surface.name === "--background"
          ? "--foreground"
          : `${surface.name}-foreground`,
      ),
    }));
  const paired = new Set(
    pairs.flatMap(({ surface, text }) => [surface.name, text?.name]),
  );
  const charts = colors.filter((token) => token.name.startsWith("--chart-"));
  const lines = colors.filter(
    (token) =>
      !paired.has(token.name) &&
      !token.name.startsWith("--chart-") &&
      /(border|input|ring)$/.test(token.name),
  );
  const listed = new Set([
    ...paired,
    ...charts.map((token) => token.name),
    ...lines.map((token) => token.name),
  ]);
  const otherColors = colors.filter((token) => !listed.has(token.name));
  const radius = byName.get("--radius");

  return (
    <div
      ref={scope}
      data-copilotkit
      className="min-h-screen bg-background px-10 py-12 text-foreground"
    >
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">Foundations</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Design tokens
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Live values of the custom properties CopilotKit defines on{" "}
            <code className="font-mono text-foreground">[data-copilotkit]</code>{" "}
            in{" "}
            <code className="font-mono text-foreground">
              styles/globals.css
            </code>
            . Toggle the theme in the toolbar to see the dark values.
          </p>
        </header>

        <Section
          title="Surfaces and text"
          description="Each surface with the foreground color meant to sit on it."
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {pairs.map(({ surface, text }) => (
              <PairSwatch key={surface.name} surface={surface} text={text} />
            ))}
          </div>
        </Section>

        <Section
          title="Lines and focus"
          description="Borders, input outlines and focus rings."
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {lines.map((token) => (
              <ColorSwatch key={token.name} {...token} />
            ))}
          </div>
        </Section>

        {charts.length > 0 && (
          <Section title="Charts" description="Categorical series colors.">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {charts.map((token) => (
                <ColorSwatch key={token.name} {...token} />
              ))}
            </div>
          </Section>
        )}

        {otherColors.length > 0 && (
          <Section title="Other colors" description="Tokens without a pairing.">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {otherColors.map((token) => (
                <ColorSwatch key={token.name} {...token} />
              ))}
            </div>
          </Section>
        )}

        <Section
          title="Radius"
          description={`--radius is ${radius?.value || "unset"}; the scale steps derive from it.`}
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {radii.map(({ label, css }) => (
              <div key={label} className="space-y-3">
                <div
                  className="h-20 border border-border bg-muted"
                  style={{ borderRadius: css }}
                />
                <div className="space-y-1">
                  <span className="block font-mono text-xs">
                    radius-{label}
                  </span>
                  <Value>{css}</Value>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Type"
          description="The text styles chat components use, in the CopilotKit scope's font."
        >
          <div className="divide-y divide-border rounded-xl border border-border">
            {typeScale.map(({ label, className, meta }) => (
              <div
                key={label}
                className="grid grid-cols-[120px_1fr_auto] items-baseline gap-6 px-5 py-4"
              >
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className={className}>
                  The quick brown fox jumps over the lazy dog
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {meta}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
};

const meta = {
  title: "Foundations/Tokens",
  component: TokensPage,
  parameters: {
    layout: "fullscreen",
    copilotkit: false,
  },
} satisfies Meta<typeof TokensPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = {};
