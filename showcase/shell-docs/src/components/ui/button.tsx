import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

const variants = {
  primary:
    "border border-[var(--accent)] bg-[var(--accent)] text-[var(--primary-foreground)] hover:bg-[var(--accent-strong)] disabled:border-[var(--border)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)]",
  outline:
    "border border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent-dim)] hover:text-[var(--accent)]",
  ghost:
    "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
  secondary:
    "border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-[var(--shadow-control)] hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
} as const;

export const buttonVariants = cva(
  "shell-docs-radius-control inline-flex items-center justify-center p-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  {
    variants: {
      variant: variants,
      // fumadocs use `color` instead of `variant`
      color: variants,
      size: {
        sm: "gap-1 px-2 py-1.5 text-xs",
        icon: "p-1.5 [&_svg]:size-5",
        "icon-sm": "p-1.5 [&_svg]:size-4.5",
        "icon-xs": "p-1 [&_svg]:size-4",
      },
    },
  },
);

export type ButtonProps = VariantProps<typeof buttonVariants>;
