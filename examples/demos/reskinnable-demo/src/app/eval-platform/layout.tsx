import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Benchline Evals",
  description: "A stand-in for the customer's own eval platform.",
};

export default function EvalPlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
