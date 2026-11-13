"use client";

// The legacy (v1) self-hosting snippets' provider picker (shell-docs had no
// component for it, so those pages failed there): choose an LLM
// provider, and `<If>` blocks and `{{key}}` placeholders in the code follow it.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { quickStartProviders, type ProviderConfig } from "./providers";

const ProviderContext = createContext<ProviderConfig | null>(null);

/** Original text of each placeholder node, so a later pick can refill it. */
const originals = new WeakMap<Text, string>();

function fillPlaceholders(root: HTMLElement, provider: ProviderConfig) {
  const values = provider as unknown as Record<string, string | undefined>;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const original = originals.get(text) ?? text.nodeValue ?? "";
    if (!original.includes("{{")) continue;
    originals.set(text, original);
    text.nodeValue = original.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => values[key] ?? "",
    );
  }
}

export function MultiProviderContent({
  // Content passed the list from an import that's stripped at sync.
  providersConfig = quickStartProviders,
  children,
}: {
  providersConfig?: ProviderConfig[];
  children?: ReactNode;
}) {
  const [id, setId] = useState(providersConfig[0]?.id);
  const provider = providersConfig.find((p) => p.id === id) ?? null;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && provider) fillPlaceholders(ref.current, provider);
  });

  return (
    <ProviderContext.Provider value={provider}>
      <ToggleGroup
        aria-label="LLM provider"
        variant="outline"
        size="sm"
        className="not-prose my-4 flex-wrap"
        value={id ? [id] : []}
        onValueChange={(value) => {
          if (value[0]) setId(String(value[0]));
        }}
      >
        {providersConfig.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id}>
            {p.title}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div ref={ref}>{children}</div>
    </ProviderContext.Provider>
  );
}

/**
 * Renders its children when the picked provider matches any condition
 * (`value: true` means the provider has that key at all).
 */
export function If({
  conditions,
  children,
}: {
  conditions: { key: string; value: unknown }[];
  children?: ReactNode;
}) {
  const provider = useContext(ProviderContext) as unknown as Record<
    string,
    unknown
  > | null;
  if (!provider) return null;
  const matches = conditions.some(({ key, value }) =>
    value === true ? Boolean(provider[key]) : provider[key] === value,
  );
  return matches ? <>{children}</> : null;
}
