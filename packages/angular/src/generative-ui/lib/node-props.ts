import type { DataModel } from "@a2ui/web_core/v0_9";
import {
  A2UI_COMPONENT_ENVELOPE_KEYS,
  isPathBinding,
} from "@copilotkit/shared";
import {
  formatIssues,
  isAsyncIssue,
  isRecord,
  issueKey,
  validateSchemaSync,
  withoutRejectedNulls,
} from "@copilotkit/shared/generative-ui";
import {
  readAccessibility,
  tryResolveDynamicValue,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUIAccessibility } from "@copilotkit/core/generative-ui";
import type { ResolvedGenerativeUIComponent } from "./catalog";

// The data props of a node: resolve the model-set props from the data model,
// check them with the props schema, run the selectors, then parse all props.
// Pure functions and one cache object; the signals around them are in node.ts.

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key],
  );
}

/**
 * A value that a prop resolved to, with a new identity when it is a list or
 * an object. web_core changes lists and objects in place, so a value read
 * straight from the data model keeps its identity across a change. A signal
 * input compares by identity and would not see the change; the copy makes
 * it visible. A prop is resolved again only when something changed, so the
 * copy happens only then.
 */
function freshIdentity(value: unknown) {
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object" && value !== null) return { ...value };
  return value;
}

/** What one data prop resolved to, and what it read to get there. */
interface ResolvedProp {
  /** The raw prop value it was resolved from. */
  raw: unknown;
  /** The template item path it was resolved in. */
  basePath: string | undefined;
  /** The value, or the reason it could not be computed. */
  outcome: { ok: true; value: unknown } | { ok: false; message: string };
  /** The data model value at each path it read, when it was resolved. */
  reads: Map<string, unknown>;
}

export type ModelData =
  | {
      ok: true;
      values: Record<string, unknown>;
      /** The resolved `accessibility` of the component envelope. */
      accessibility: GenerativeUIAccessibility | undefined;
    }
  | { ok: false; problem: string };

export function sameModelData(a: ModelData, b: ModelData) {
  if (a.ok && b.ok) {
    return (
      shallowEqual(a.values, b.values) &&
      shallowEqual(
        (a.accessibility ?? {}) as Record<string, unknown>,
        (b.accessibility ?? {}) as Record<string, unknown>,
      )
    );
  }
  return !a.ok && !b.ok && a.problem === b.problem;
}

/**
 * Resolves the props the model sets, with their dynamic values read from the
 * surface data model: `{"@path"}` bindings, `{"@call"}` function values and
 * `{"@call":"@index"}` in a template, at any depth. A literal writable prop
 * that the component set shows the local value from `overrides`. Bound
 * props, events and slots are left out, and so are the keys of the A2UI
 * component envelope; `accessibility` is resolved the same way and given on
 * its own.
 *
 * A prop is resolved again only when its raw value or a data model value it
 * read has changed. `invalidate()` drops the cache: web_core changes lists
 * and objects in place, so a changed item inside one keeps the identity of
 * the list.
 */
export class ModelPropsResolver {
  #cache = new Map<string, ResolvedProp>();
  /** The data model paths the last resolution read, sorted and joined. */
  pathKey = "";

  invalidate() {
    this.#cache = new Map();
  }

  /** True when a value read by the last resolution has changed since. */
  isStale(dataModel: DataModel) {
    for (const entry of this.#cache.values()) {
      for (const [path, value] of entry.reads) {
        if (!Object.is(dataModel.get(path), value)) return true;
      }
    }
    return false;
  }

  resolve(
    definition: ResolvedGenerativeUIComponent,
    properties: Record<string, unknown>,
    basePath: string | undefined,
    overrides: Record<string, unknown>,
    dataModel: DataModel,
  ): ModelData {
    // The units to resolve: each model prop, and each field of the envelope's
    // `accessibility` on its own, so a label that cannot be computed does not
    // take the other fields with it.
    const units: Array<{ key: string; raw: unknown; field?: string }> = [];
    for (const key of Object.keys(properties)) {
      if (
        definition.events?.[key] ||
        definition.slots?.[key] ||
        Object.prototype.hasOwnProperty.call(definition.selectors, key) ||
        A2UI_COMPONENT_ENVELOPE_KEYS.has(key)
      ) {
        continue;
      }
      units.push({ key, raw: properties[key] });
    }
    const a11y = properties.accessibility;
    if (isRecord(a11y)) {
      for (const [field, raw] of Object.entries(a11y)) {
        units.push({ key: `accessibility/${field}`, raw, field });
      }
    }
    const values: Record<string, unknown> = {};
    const a11yValues: Record<string, unknown> = {};
    const paths = new Set<string>();
    let problem: string | undefined;
    const next = new Map<string, ResolvedProp>();
    for (const { key, raw, field } of units) {
      const cached = this.#cache.get(key);
      const isFresh =
        cached !== undefined &&
        cached.raw === raw &&
        cached.basePath === basePath &&
        [...cached.reads].every(([path, value]) =>
          Object.is(dataModel.get(path), value),
        );
      const resolve = (): ResolvedProp => {
        const resolved = tryResolveDynamicValue(
          raw,
          { data: dataModel, basePath },
          { isChecks: key === "checks" },
        );
        // The reads are kept also when the resolution failed, so the node
        // stays subscribed to the data that can fix it.
        const reads = new Map<string, unknown>();
        for (const path of resolved.paths) reads.set(path, dataModel.get(path));
        return {
          raw,
          basePath,
          reads,
          outcome: resolved.ok
            ? { ok: true, value: freshIdentity(resolved.value) }
            : { ok: false, message: resolved.error.message },
        };
      };
      const entry = isFresh && cached ? cached : resolve();
      next.set(key, entry);
      if (field !== undefined) {
        // The envelope is not a prop: a label that cannot be computed names
        // nothing, and the component is not at fault for it.
        if (entry.outcome.ok) a11yValues[field] = entry.outcome.value;
      } else if (entry.outcome.ok) values[key] = entry.outcome.value;
      else problem ??= `${key}: ${entry.outcome.message}`;
      for (const path of entry.reads.keys()) paths.add(path);
    }
    this.#cache = next;
    this.pathKey = [...paths].sort().join("\n");
    for (const [key, value] of Object.entries(overrides)) {
      if (!isPathBinding(properties[key])) values[key] = value;
    }
    if (problem !== undefined) return { ok: false, problem };
    return { ok: true, values, accessibility: readAccessibility(a11yValues) };
  }
}

export type ModelCheck =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problem: string };

/**
 * Checks the model-set props with the props schema before the selectors run.
 * The bound props are not set yet, so their issues do not count. Neither do
 * issues with no path (a check over several props), which the full check
 * after the selectors reports.
 */
export function checkModelProps(
  definition: ResolvedGenerativeUIComponent,
  modelData: Record<string, unknown>,
): ModelCheck {
  if (!definition.props) return { ok: true, values: {} };
  let values = modelData;
  let result = validateSchemaSync(definition.props, values);
  if (!result.success) {
    // A null the schema rejects is an unset prop: check again without it.
    const unset = withoutRejectedNulls(values, result.issues);
    if (unset) {
      values = unset;
      result = validateSchemaSync(definition.props, values);
    }
  }
  if (!result.success) {
    const issues = result.issues.filter((issue) => {
      const key = issueKey(issue);
      return key === undefined
        ? isAsyncIssue(issue)
        : !Object.prototype.hasOwnProperty.call(definition.selectors, key);
    });
    if (issues.length > 0) return { ok: false, problem: formatIssues(issues) };
  }
  return { ok: true, values };
}

/** The selector results of one node, or the reason they could not be read. */
export type Selection =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problem: string };

export const NO_SELECTION: Selection = { ok: true, values: {} };

export function sameSelection(a: Selection, b: Selection) {
  if (a.ok && b.ok) return shallowEqual(a.values, b.values);
  if (!a.ok && !b.ok) return a.problem === b.problem;
  return false;
}

/** Runs every selector of a node. A selector that throws gives a problem. */
export function selectBoundProps(
  definition: ResolvedGenerativeUIComponent,
  state: Readonly<Record<string, unknown>>,
  modelProps: Record<string, unknown>,
): Selection {
  const values: Record<string, unknown> = {};
  for (const [key, selector] of Object.entries(definition.selectors)) {
    try {
      values[key] = selector(state, modelProps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, problem: `${key}: selector threw: ${message}` };
    }
  }
  return { ok: true, values };
}

export type DataProps =
  | {
      ok: true;
      props: Record<string, unknown>;
      accessibility: GenerativeUIAccessibility | undefined;
    }
  | { ok: false; problem: string };

/** Parses the model props and the selected props together with the props schema. */
export function parseDataProps(
  definition: ResolvedGenerativeUIComponent,
  modelValues: Record<string, unknown>,
  selected: Record<string, unknown>,
  accessibility: GenerativeUIAccessibility | undefined,
): DataProps {
  if (!definition.props) return { ok: true, props: {}, accessibility };
  const input = { ...modelValues, ...selected };
  let parsed = validateSchemaSync(definition.props, input);
  if (!parsed.success) {
    // A null the schema rejects is an unset prop: validate without it.
    const unset = withoutRejectedNulls(input, parsed.issues);
    if (unset) parsed = validateSchemaSync(definition.props, unset);
  }
  if (!parsed.success) {
    return { ok: false, problem: formatIssues(parsed.issues) };
  }
  return {
    ok: true,
    props: parsed.data as Record<string, unknown>,
    accessibility,
  };
}
