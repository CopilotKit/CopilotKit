import { A2UI_ROOT_COMPONENT_ID } from "./constants";
import type { A2UIOperation } from "./operations";
import { isRecord, surfaceHasRenderableContent } from "./operations";

/**
 * How long a surface may take to report its first paint before the loader
 * hand-off gives up and shows it anyway. Reaching it with no paint is also the
 * moment the unpainted and unresolved-root diagnostics fire.
 */
export const A2UI_PAINT_FALLBACK_MS = 8000;

/** The live surface model, as far as the diagnostics read it. */
export interface A2UIDiagnosedSurface {
  componentsModel: { get(componentId: string): unknown };
}

/** The operation kinds a surface received, comma-separated, or "none". */
function describeOperationKinds(operations: readonly A2UIOperation[]) {
  const kinds = new Set<string>();
  for (const operation of operations) {
    for (const key of Object.keys(operation)) {
      if (key !== "version") kinds.add(key);
    }
  }
  return kinds.size === 0 ? "none" : Array.from(kinds).join(", ");
}

function componentLists(operations: readonly A2UIOperation[]) {
  const lists: unknown[][] = [];
  for (const operation of operations) {
    const update = operation.updateComponents;
    if (isRecord(update) && Array.isArray(update.components)) {
      lists.push(update.components);
    }
  }
  return lists;
}

/** The component ids a surface was sent, quoted and comma-separated, or "none". */
function describeComponentIds(operations: readonly A2UIOperation[]) {
  const ids: string[] = [];
  const lists = componentLists(operations);
  for (const components of lists) {
    for (const component of components) {
      const id = isRecord(component) ? component.id : undefined;
      if (typeof id === "string" && !ids.includes(id)) ids.push(id);
    }
  }
  return ids.length === 0 ? "none" : ids.map((id) => `"${id}"`).join(", ");
}

/**
 * Explains why a surface that received operations never painted, or returns
 * null when its operations are enough to paint.
 *
 * Reaching {@link A2UI_PAINT_FALLBACK_MS} with no paint means the operations
 * were accepted and still put nothing on screen. Left alone that is
 * invisible, so the message says which half is missing.
 *
 * @param surfaceId - The surface the operations address.
 * @param operations - The operations grouped under that surface.
 */
export function diagnoseUnpaintedSurface(
  surfaceId: string,
  operations: readonly A2UIOperation[],
) {
  if (surfaceHasRenderableContent(operations)) return null;
  const cause =
    componentLists(operations).length === 0
      ? "no updateComponents operation arrived, so the surface was never given anything to draw"
      : 'its components address their values by "path" and no updateDataModel carried a non-empty value, so every bound component drew empty';
  return (
    `[CopilotKit] A2UI surface "${surfaceId}" received operations and never ` +
    `painted after ${String(A2UI_PAINT_FALLBACK_MS)}ms: ${cause}. ` +
    `Operations received: ${describeOperationKinds(operations)}. ` +
    `The payload was accepted, so check what the agent sent rather than the ` +
    `client wiring. This warning is development-only.`
  );
}

/**
 * Explains a surface that never got created although operations addressed
 * it. The usual cause is operations sent to one surface id while the surface
 * was created under another, or operations that were all dropped as invalid.
 *
 * @param surfaceId - The surface the operations address.
 * @param operations - The operations processed for that surface.
 */
export function diagnoseMissingSurface(
  surfaceId: string,
  operations: readonly A2UIOperation[],
) {
  return (
    `[CopilotKit] A2UI processed ${String(operations.length)} operation(s) addressed ` +
    `to surface "${surfaceId}" and no surface by that id exists, so this ` +
    `card rendered nothing. Operations received: ` +
    `${describeOperationKinds(operations)}. A createSurface for "${surfaceId}" has ` +
    `to arrive before, or with, the operations that target it. ` +
    `This warning is development-only.`
  );
}

/**
 * Explains a surface still waiting for its root component once operations
 * have stopped arriving, or returns null when the root resolved (or when no
 * components arrived at all, which {@link diagnoseUnpaintedSurface} explains
 * better).
 *
 * Renderers begin walking a surface at the root id and treat an id they cannot
 * find as not arrived yet, so a payload without it animates a placeholder
 * forever while every other check calls it healthy. Reads the live components
 * model, so it covers every way the root can fail to resolve.
 *
 * @param surfaceId - The surface the operations address.
 * @param operations - The operations processed for that surface.
 * @param surface - The live surface model.
 */
export function diagnoseUnresolvedRoot(
  surfaceId: string,
  operations: readonly A2UIOperation[],
  surface: A2UIDiagnosedSurface,
) {
  if (surface.componentsModel.get(A2UI_ROOT_COMPONENT_ID)) return null;
  const lists = componentLists(operations);
  if (lists.length === 0) return null;

  const rootWasSent = lists.some((components) =>
    components.some(
      (component) =>
        isRecord(component) && component.id === A2UI_ROOT_COMPONENT_ID,
    ),
  );
  const cause = rootWasSent
    ? `a component with id "${A2UI_ROOT_COMPONENT_ID}" WAS sent, so the components ` +
      `did not reach the surface's model — check for an A2UI render error above, ` +
      `or a catalog that took none of them`
    : `the components it received are named ${describeComponentIds(operations)}, ` +
      `and none of them is "${A2UI_ROOT_COMPONENT_ID}" — rename the entry-point ` +
      `component to "${A2UI_ROOT_COMPONENT_ID}", and make every other component ` +
      `reachable from it through child/children`;

  return (
    `[CopilotKit] A2UI surface "${surfaceId}" has no "${A2UI_ROOT_COMPONENT_ID}" ` +
    `component ${String(A2UI_PAINT_FALLBACK_MS)}ms after its last operations were ` +
    `processed, so it is showing the placeholder for a component that has not ` +
    `arrived yet and will keep showing it: ${cause}. Operations received: ` +
    `${describeOperationKinds(operations)}. This warning is development-only.`
  );
}
