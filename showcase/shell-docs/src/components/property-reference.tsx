"use client";

import type { ReactNode } from "react";
import { TypeTable } from "fumadocs-ui/components/type-table";

type Props = {
  name: string;
  type: string;
  required?: boolean;
  deprecated?: boolean;
  children?: ReactNode;
  cloudOnly?: boolean;
  default?: string;
  collapsable?: boolean;
};

export function PropertyReference({
  children,
  name,
  type,
  required = false,
  deprecated = false,
  cloudOnly = false,
  default: defaultValue,
}: Props) {
  return (
    <TypeTable
      className="shell-docs-property-reference"
      type={{
        [name]: {
          type,
          required,
          deprecated,
          default:
            defaultValue === undefined ? undefined : (
              <code>{defaultValue}</code>
            ),
          description: (
            <div className="space-y-3">
              {cloudOnly && (
                <div>
                  <span className="shell-docs-radius-control inline-flex items-center justify-center bg-[var(--brand-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-accent-foreground)]">
                    COPILOT CLOUD
                  </span>
                </div>
              )}
              <div className="prose-no-margin">{children}</div>
            </div>
          ),
        },
      }}
    />
  );
}
