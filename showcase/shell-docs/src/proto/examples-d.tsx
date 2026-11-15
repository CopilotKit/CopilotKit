"use client";

import dynamic from "next/dynamic";

/**
 * The examples playground at /examples. It carries the examples catalog
 * (src/proto/examples.ts), so it loads where it renders, not with every page
 * the docs route serves.
 */
export const DExamples = dynamic(() =>
  import("./examples-playground").then((m) => m.ExamplesPlayground),
);
