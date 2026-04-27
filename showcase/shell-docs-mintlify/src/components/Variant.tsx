import type { ReactNode } from 'react';
import { INTEGRATIONS } from '../lib/integration';

interface VariantProps {
  /** Space-separated list of integration slugs this block is for. */
  for: string;
  children: ReactNode;
}

const KNOWN = new Set<string>(INTEGRATIONS);

export default function Variant({ for: forProp, children }: VariantProps) {
  const slugs = forProp.trim().split(/\s+/).filter(Boolean);
  const unknown = slugs.filter((s) => !KNOWN.has(s));
  if (unknown.length && import.meta.env.DEV) {
    console.warn(
      `<Variant for="${forProp}"> contains unknown integration(s): ${unknown.join(', ')}. ` +
        `Known: ${[...KNOWN].join(', ')}.`,
    );
  }
  return <div data-variant-for={slugs.join(' ')}>{children}</div>;
}
