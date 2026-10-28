import type { Metadata } from "next";
import { KiteHome } from "@/proto/kite";

export const metadata: Metadata = {
  title: "Ask Kite | CopilotKit Docs",
  description:
    "Explore CopilotKit with Kite and build an onboarding guide for your app.",
  alternates: { canonical: "/kite" },
};

export default function KitePage() {
  return <KiteHome />;
}
