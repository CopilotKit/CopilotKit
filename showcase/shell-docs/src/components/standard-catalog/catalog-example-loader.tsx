"use client";
import React from "react";
import dynamic from "next/dynamic";

const Examples = dynamic(
  () =>
    import("./catalog-reference-examples").then(
      (module) => module.CatalogReferenceExamples,
    ),
  {
    ssr: false,
    loading: ({ error }) =>
      error ? (
        <p role="alert">
          The examples could not load. Reload the page to try again.
        </p>
      ) : (
        <p>Loading examples…</p>
      ),
  },
);
export function CatalogExampleLoader({ name }: { name: string }) {
  return <Examples name={name} />;
}
