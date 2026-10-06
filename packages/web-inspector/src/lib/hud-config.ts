import { prerelease, satisfies, valid, validRange } from "semver";
import type { NotificationContext } from "./notifications.js";

/** Versioned CDN HUD contract. Keep the Intelligence copy and fixtures aligned. */
export type HudFramework = "react" | "vue" | "angular";
export type HudFeatureId = "threads" | "learning";
export interface HudFeatureContent {
  label: string;
  description: string;
  destination: string;
}
export type HudContent = Record<HudFeatureId, HudFeatureContent>;
export type HudFeatureOverride = Partial<HudFeatureContent>;
export interface HudRule {
  /** Frameworks unknown to this SDK are kept but never match. */
  framework: string;
  sdkVersion: string;
  /** Keyed by feature ID; IDs unknown to this SDK are kept but never applied. */
  features: Record<string, HudFeatureOverride>;
}
export interface HudFeed {
  schemaVersion: 1;
  rules: HudRule[];
}
export type HudContext = Pick<
  NotificationContext,
  "development" | "framework" | "sdkVersion"
>;
export interface HudResolveOptions {
  defaults: HudContent;
  /** Destination keys this SDK can open; anything else keeps the default. */
  supportedDestinations: readonly string[];
}

export const HUD_FEATURE_IDS: readonly HudFeatureId[] = ["threads", "learning"];
export const HUD_LABEL_MAX_LENGTH = 32;
export const HUD_DESCRIPTION_MAX_LENGTH = 140;
const frameworkPattern = /^[a-z][a-z0-9-]{0,31}$/;
const featureIdPattern = /^[a-z][a-z0-9-]{0,31}$/;
const destinationPattern = /^[a-z][a-z0-9-]{0,63}$/;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !controlCharacters.test(value)
  );
}
function parseFeature(value: unknown): HudFeatureOverride | null {
  if (
    !record(value) ||
    !Object.keys(value).length ||
    !onlyKeys(value, ["label", "description", "destination"])
  )
    return null;
  if (value.label !== undefined && !text(value.label, HUD_LABEL_MAX_LENGTH))
    return null;
  if (
    value.description !== undefined &&
    !text(value.description, HUD_DESCRIPTION_MAX_LENGTH)
  )
    return null;
  if (
    value.destination !== undefined &&
    (typeof value.destination !== "string" ||
      !destinationPattern.test(value.destination))
  )
    return null;
  return {
    ...(value.label === undefined ? {} : { label: value.label }),
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    ...(value.destination === undefined
      ? {}
      : { destination: value.destination }),
  };
}
function parseRule(value: unknown): HudRule | null {
  if (
    !record(value) ||
    !onlyKeys(value, ["framework", "sdkVersion", "features"]) ||
    typeof value.framework !== "string" ||
    !frameworkPattern.test(value.framework) ||
    !text(value.sdkVersion, 256) ||
    validRange(value.sdkVersion) === null ||
    !record(value.features) ||
    !Object.keys(value.features).length
  )
    return null;
  const features: Record<string, HudFeatureOverride> = {};
  for (const [id, entry] of Object.entries(value.features)) {
    if (!featureIdPattern.test(id)) return null;
    const feature = parseFeature(entry);
    if (!feature) return null;
    features[id] = feature;
  }
  return {
    framework: value.framework,
    sdkVersion: value.sdkVersion,
    features,
  };
}

/** Parse the public envelope. Any invalid entry rejects the whole feed. */
export function parseHudFeed(value: unknown): HudFeed | null {
  if (
    !record(value) ||
    !onlyKeys(value, ["schemaVersion", "rules"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rules) ||
    value.rules.length > 100
  )
    return null;
  const rules: HudRule[] = [];
  for (const entry of value.rules) {
    const rule = parseRule(entry);
    if (!rule) return null;
    rules.push(rule);
  }
  return { schemaVersion: 1, rules };
}

/** Return the first rule for a development client with a known stable SDK. */
export function matchHudRule(
  feed: HudFeed,
  context: HudContext,
): HudRule | null {
  const { development, framework, sdkVersion } = context;
  if (
    !development ||
    !framework ||
    !sdkVersion ||
    valid(sdkVersion) === null ||
    prerelease(sdkVersion) !== null
  )
    return null;
  return (
    feed.rules.find(
      (rule) =>
        rule.framework === framework && satisfies(sdkVersion, rule.sdkVersion),
    ) ?? null
  );
}

/** Overlay the matching rule on the built-in content, field by field. */
export function resolveHudContent(
  feed: HudFeed | null,
  context: HudContext,
  options: HudResolveOptions,
): HudContent {
  const rule = feed ? matchHudRule(feed, context) : null;
  const content = {} as HudContent;
  for (const id of HUD_FEATURE_IDS) {
    const fallback = options.defaults[id];
    const override = rule?.features[id];
    content[id] = {
      label: override?.label ?? fallback.label,
      description: override?.description ?? fallback.description,
      destination:
        override?.destination !== undefined &&
        options.supportedDestinations.includes(override.destination)
          ? override.destination
          : fallback.destination,
    };
  }
  return content;
}
