import { artifacts } from "../content/concepts";
import { personaSlugs } from "../content/types";
import type {
  Composition,
  ConceptId,
  Persona,
  PersonaGroup,
  ResourceRef,
  StoryPage,
} from "../content/types";
import { resolveDemo, resolveResource } from "./registry";

const personaSlugSet = new Set<string>(personaSlugs);

const personaGroups = {
  leadership: true,
  "go-to-market": true,
  partnerships: true,
  oss: true,
} as const satisfies Record<PersonaGroup, true>;

const compositions = {
  statement: true,
  diagram: true,
  "live-proof": true,
  artifact: true,
  action: true,
} as const satisfies Record<Composition, true>;

const concepts = {
  ecosystem: true,
  proof: true,
  ownership: true,
  audience: true,
} as const satisfies Record<ConceptId, true>;

type VisualKind = StoryPage["visual"]["kind"];

const visualKinds = {
  illustration: true,
  "system-map": true,
  "manifest-flow": true,
  "proof-flow": true,
  "ownership-handoff": true,
  "coverage-map": true,
  demo: true,
  artifact: true,
  checklist: true,
} as const satisfies Record<VisualKind, true>;

type OwnershipPerspective = Extract<
  StoryPage["visual"],
  { kind: "ownership-handoff" }
>["perspective"];

const ownershipPerspectives = {
  partnerships: true,
  oss: true,
} as const satisfies Record<OwnershipPerspective, true>;

const forbiddenDashPattern = /[–—]/u;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function display(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function assertRecord(
  value: unknown,
  context: string,
): asserts value is UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`);
  }
}

function assertVisibleString(
  value: unknown,
  context: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-blank string.`);
  }

  if (forbiddenDashPattern.test(value)) {
    throw new Error(
      `${context} must not contain an en dash or em dash. Use an ASCII hyphen (-) instead.`,
    );
  }
}

function assertKnownKey<T extends object>(
  value: unknown,
  allowed: T,
  context: string,
): asserts value is Extract<keyof T, string> {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(allowed, value)
  ) {
    throw new Error(`${context} has unknown value "${display(value)}".`);
  }
}

function assertNever(value: never, context: string): never {
  const runtimeValue = value as { kind?: unknown };
  throw new Error(
    `${context} has unknown value "${display(runtimeValue.kind)}".`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateVisual(value: unknown, pageContext: string): void {
  const visualContext = `${pageContext}, field "visual"`;
  const visualField = (field: string) =>
    `${pageContext}, field "visual.${field}"`;
  assertRecord(value, visualContext);

  const kind = value.kind;
  assertKnownKey(kind, visualKinds, visualField("kind"));
  const visual = value as StoryPage["visual"];

  switch (visual.kind) {
    case "illustration":
      assertKnownKey(visual.concept, concepts, visualField("concept"));
      assertVisibleString(visual.alt, visualField("alt"));
      return;
    case "system-map":
    case "manifest-flow":
    case "proof-flow":
    case "coverage-map":
      return;
    case "ownership-handoff":
      assertKnownKey(
        visual.perspective,
        ownershipPerspectives,
        visualField("perspective"),
      );
      return;
    case "demo": {
      assertVisibleString(visual.integration, visualField("integration"));
      assertVisibleString(visual.demo, visualField("demo"));

      try {
        resolveDemo(visual.integration, visual.demo);
      } catch (error) {
        throw new Error(`${visualContext} is invalid: ${errorMessage(error)}`, {
          cause: error,
        });
      }
      return;
    }
    case "artifact":
      assertKnownKey(visual.artifact, artifacts, visualField("artifact"));
      return;
    case "checklist": {
      const items = visual.items;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error(
          `${visualField("items")} must contain at least one item.`,
        );
      }

      for (const [index, item] of items.entries()) {
        assertVisibleString(item, visualField(`items[${index}]`));
      }
      return;
    }
    default:
      return assertNever(visual, visualField("kind"));
  }
}

function validateResources(value: unknown, pageContext: string): void {
  const resourcesContext = `${pageContext}, field "resources"`;

  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error(`${resourcesContext} must contain between 1 and 3 items.`);
  }

  for (const [index, resource] of value.entries()) {
    const resourceContext = `${pageContext}, field "resources[${index}]"`;
    assertRecord(resource, resourceContext);

    try {
      resolveResource(resource as ResourceRef);
    } catch (error) {
      throw new Error(`${resourceContext} is invalid: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }
}

function validateDeepDive(value: unknown, pageContext: string): void {
  const deepDiveContext = `${pageContext}, field "deepDive"`;
  const deepDiveField = (field: string) =>
    `${pageContext}, field "deepDive.${field}"`;
  assertRecord(value, deepDiveContext);
  assertVisibleString(value.label, deepDiveField("label"));

  if (value.label !== "Go deeper") {
    throw new Error(`${deepDiveField("label")} must be exactly "Go deeper".`);
  }

  assertVisibleString(value.summary, deepDiveField("summary"));

  for (const field of ["commands", "paths", "failureModes"] as const) {
    if (!(field in value)) {
      continue;
    }

    const items = value[field];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        `${deepDiveField(field)} must contain at least one item when present.`,
      );
    }

    for (const [index, item] of items.entries()) {
      assertVisibleString(item, deepDiveField(`${field}[${index}]`));
    }
  }
}

function validatePage(
  value: unknown,
  personaContext: string,
  pageIndex: number,
  pageSlugs: Set<string>,
): Composition {
  const fallbackContext = `${personaContext}, page at index ${pageIndex}`;
  assertRecord(value, fallbackContext);

  const pageName =
    typeof value.slug === "string" && value.slug.length > 0
      ? value.slug
      : `index ${pageIndex}`;
  const pageContext = `${personaContext}, page "${pageName}"`;
  assertVisibleString(value.slug, `${pageContext}, field "slug"`);

  if (pageSlugs.has(value.slug)) {
    throw new Error(
      `${pageContext}, field "slug" duplicates page slug "${value.slug}".`,
    );
  }
  pageSlugs.add(value.slug);

  assertVisibleString(value.title, `${pageContext}, field "title"`);
  assertVisibleString(value.claim, `${pageContext}, field "claim"`);
  assertVisibleString(value.body, `${pageContext}, field "body"`);
  const composition = value.composition;
  assertKnownKey(
    composition,
    compositions,
    `${pageContext}, field "composition"`,
  );
  validateVisual(value.visual, pageContext);
  validateResources(value.resources, pageContext);

  if (value.deepDive !== undefined) {
    validateDeepDive(value.deepDive, pageContext);
  }

  return composition;
}

export function validatePersonas(personas: readonly Persona[]): void {
  if (!Array.isArray(personas)) {
    throw new Error("Persona collection must be an array.");
  }

  if (personas.length === 0) {
    throw new Error("Stories must contain at least one persona.");
  }

  const seenPersonaSlugs = new Set<string>();

  for (const [personaIndex, value] of personas.entries()) {
    const fallbackContext = `Persona at index ${personaIndex}`;
    assertRecord(value, fallbackContext);

    const personaName =
      typeof value.slug === "string" && value.slug.length > 0
        ? value.slug
        : `index ${personaIndex}`;
    const personaContext = `Persona "${personaName}"`;
    assertVisibleString(value.slug, `${personaContext}, field "slug"`);

    if (!personaSlugSet.has(value.slug)) {
      throw new Error(
        `${personaContext}, field "slug" has unknown value "${value.slug}".`,
      );
    }

    if (seenPersonaSlugs.has(value.slug)) {
      throw new Error(`Duplicate persona slug "${value.slug}".`);
    }
    seenPersonaSlugs.add(value.slug);

    assertVisibleString(value.name, `${personaContext}, field "name"`);
    assertKnownKey(
      value.group,
      personaGroups,
      `${personaContext}, field "group"`,
    );
    assertVisibleString(value.summary, `${personaContext}, field "summary"`);
    assertVisibleString(value.question, `${personaContext}, field "question"`);

    if (
      typeof value.minutes !== "number" ||
      !Number.isFinite(value.minutes) ||
      !Number.isInteger(value.minutes) ||
      value.minutes <= 0
    ) {
      throw new Error(
        `${personaContext}, field "minutes" must be a finite positive integer.`,
      );
    }

    if (value.systemOwner !== undefined && value.systemOwner !== true) {
      throw new Error(
        `${personaContext}, field "systemOwner" must be true when present.`,
      );
    }

    if (!Array.isArray(value.pages) || value.pages.length === 0) {
      throw new Error(
        `${personaContext}, field "pages" must contain at least one page.`,
      );
    }

    const pageSlugs = new Set<string>();
    let lastComposition: Composition | undefined;
    let lastPageSlug = "";

    for (const [pageIndex, storyPage] of value.pages.entries()) {
      lastComposition = validatePage(
        storyPage,
        personaContext,
        pageIndex,
        pageSlugs,
      );
      lastPageSlug = (storyPage as UnknownRecord).slug as string;
    }

    if (lastComposition !== "action") {
      throw new Error(
        `${personaContext}, page "${lastPageSlug}" must use the "action" composition because it is the final page.`,
      );
    }
  }
}
