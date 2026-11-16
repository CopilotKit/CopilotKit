import { useEffect, useState } from "react";
import { isComponentName } from "./catalog-index";

/**
 * The Gen UI 2.0 standard component names, read from the installed package, for the menu sheet's catalog list.
 * The package is large, so it loads the first time the list is about to show (pages that render surfaces
 * already have it).
 */
export function useStandardNames(load: boolean) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!load || names.length) return;
    let live = true;
    import("@copilotkit/react-core/v2/generative-ui")
      .then(({ standardUI }) => {
        if (live)
          setNames(
            Object.keys(standardUI.manifestComponents).filter(
              (n) => !isComponentName(n),
            ),
          );
      })
      .catch((e) =>
        console.warn("The menu could not load the standard components", e),
      );
    return () => {
      live = false;
    };
  }, [load, names.length]);
  return names;
}
