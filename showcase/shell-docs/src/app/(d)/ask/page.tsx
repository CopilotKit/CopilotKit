import type { Metadata } from "next";
import { AskPage } from "@/components/ask/ask-page";

export const metadata: Metadata = {
  title: "Ask CopilotKit",
  description:
    "Ask about CopilotKit, or get a step-by-step guide written for your stack, ready to hand to your coding agent.",
};

/** Ask CopilotKit on a full page, under the home's navbar. */
export default function Page() {
  return <AskPage />;
}
