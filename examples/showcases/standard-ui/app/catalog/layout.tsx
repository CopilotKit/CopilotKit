import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "All 69 CopilotKit standard generative UI components, each rendered live from the operations a model would write, with the props the model sees.",
};

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return children;
}
