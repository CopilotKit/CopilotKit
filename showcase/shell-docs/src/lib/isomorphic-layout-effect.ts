/**
 * `useLayoutEffect` runs synchronously after commit but before the browser
 * paints, which is exactly what a pre-paint DOM change needs: anything that
 * effect does is folded into the very first frame the reader sees, instead
 * of flashing an intermediate render first and correcting it a tick later.
 * `useEffect` runs after paint, so it cannot prevent that flash — it only
 * reacts to it.
 *
 * The catch is that React warns ("useLayoutEffect does nothing on the
 * server") whenever it renders a component that calls `useLayoutEffect`
 * during server rendering, because there is no paint to run ahead of there.
 * A component that is server-rendered for its initial HTML and then
 * hydrated in the browser needs the layout-effect behaviour on the client
 * without tripping that guard on the server — hence this indirection:
 * pick `useLayoutEffect` when running in a browser (`window` exists) and
 * fall back to `useEffect` otherwise, where "otherwise" never actually
 * needs the pre-paint guarantee because there is no paint yet to race.
 */

import * as React from "react";

/** Pure so the server/client branch can be tested without faking a whole
 *  module's environment — pass the boolean either way and assert the hook
 *  it resolves to. */
export function chooseLayoutEffect(isBrowser: boolean): typeof React.useEffect {
  return isBrowser ? React.useLayoutEffect : React.useEffect;
}

export const useIsomorphicLayoutEffect = chooseLayoutEffect(
  typeof window !== "undefined",
);
