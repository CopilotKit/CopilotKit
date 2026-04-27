import {
  integrations as integrationsConfig,
  defaultIntegration,
  universalPages,
  referencePages,
  type IntegrationSlug,
} from '../../integrations.config';

export const INTEGRATIONS = integrationsConfig.map((i) => i.slug) as readonly IntegrationSlug[];
export type Integration = IntegrationSlug;

export const INTEGRATION_LABELS = Object.fromEntries(
  integrationsConfig.map((i) => [i.slug, i.label]),
) as Record<Integration, string>;

export const INTEGRATION_COLORS = Object.fromEntries(
  integrationsConfig.map((i) => [i.slug, i.color]),
) as Record<Integration, string>;

/**
 * Pages whose slug is preserved when switching integrations (built-in's
 * canonical URL plus aliases under each /<integration>/ prefix). The
 * IntegrationPill uses this to decide whether to keep the current page slug
 * or fall back to the target integration's quickstart. Includes both
 * conceptual `universalPages` and `referencePages` since both are universal.
 */
export const UNIVERSAL_PAGES = [
  '/',
  ...universalPages.map((p) => `/${p.slug}`),
  ...referencePages.map((p) => `/${p.slug}`),
] as readonly string[];

const PREFIXED_INTEGRATIONS = INTEGRATIONS.filter((i) => i !== defaultIntegration);

export function isIntegrationSlug(value: string): value is Integration {
  return (INTEGRATIONS as readonly string[]).includes(value);
}

export function resolveIntegration(pathname: string): Integration {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && (PREFIXED_INTEGRATIONS as readonly string[]).includes(first)) {
    return first as Integration;
  }
  return defaultIntegration;
}

export function stripIntegrationPrefix(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && (PREFIXED_INTEGRATIONS as readonly string[]).includes(first)) {
    const rest = segments.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname || '/';
}
