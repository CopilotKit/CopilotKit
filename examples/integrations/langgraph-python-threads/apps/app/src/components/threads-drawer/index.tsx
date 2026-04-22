"use client";

import { useState, useEffect, type ComponentProps } from "react";
import type ThreadsDrawerComponent from "./threads-drawer";

type Props = ComponentProps<typeof ThreadsDrawerComponent>;

export type { ThreadsDrawerProps } from "./threads-drawer";

export function ThreadsDrawer(props: Props) {
  const [Component, setComponent] = useState<
    typeof ThreadsDrawerComponent | null
  >(null);

  useEffect(() => {
    import("./threads-drawer").then((m) => setComponent(() => m.default));
  }, []);

  if (!Component) return null;
  return <Component {...props} />;
}
