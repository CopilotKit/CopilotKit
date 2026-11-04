"use client";
import React from "react";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { SAMPLES, sampleOperations, sampleSurfaceId } from "./catalog-data";
import { catalogExamples } from "./catalog-reference";
import {
  CatalogProvider,
  CatalogSurface,
  CatalogEventLog,
} from "./catalog-runtime";

export function CatalogReferenceExample({ index }: { index: number }) {
  const sample = SAMPLES[index];
  return (
    <CatalogProvider indices={[index]}>
      <section
        aria-label={sample.title}
        className="shell-docs-radius-surface overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)]"
      >
        <div className="border-b border-[var(--border)] px-5 py-3 text-sm font-medium">
          {sample.title}
        </div>
        <CatalogSurface index={index} />
        <div className="px-6 pb-3">
          <CatalogEventLog index={index} />
        </div>
        <details className="border-t border-[var(--border)]">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
            View code
          </summary>
          <div className="px-5 pb-3">
            <MdxCodeBlock
              data-language="json"
              data-title="A2UI surface operations"
            >
              <code>
                {JSON.stringify(
                  sampleOperations(
                    sample,
                    sampleSurfaceId(index),
                    standardUI.id,
                  ),
                  null,
                  2,
                )}
              </code>
            </MdxCodeBlock>
          </div>
        </details>
      </section>
    </CatalogProvider>
  );
}

export function CatalogReferenceExamples({ name }: { name: string }) {
  return (
    <div className="not-prose space-y-8">
      {catalogExamples(name).map((index) => (
        <CatalogReferenceExample key={`${name}-${index}`} index={index} />
      ))}
    </div>
  );
}
