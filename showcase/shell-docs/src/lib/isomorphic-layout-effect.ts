import { useEffect, useLayoutEffect } from "react";

// Avoid layout-effect warnings during server rendering.
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
