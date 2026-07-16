import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

const variants = {
  primary:
    "border border-[var(--brand-accent)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)] hover:bg-[var(--accent-strong)] disabled:border-[var(--border)] disabled:bg-[var(--secondary)] disabled:text-[var(--muted-foreground)]",
  outline:
    "border border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--brand-accent)] hover:bg-[var(--accent-dim)] hover:text-[var(--brand-accent)]",
  ghost:
    "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
  secondary:
    "border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-[var(--shadow-control)] hover:border-[var(--brand-accent)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
} as const;

export const buttonVariants = cva(
  "shell-docs-radius-control inline-flex items-center justify-center p-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]",
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
