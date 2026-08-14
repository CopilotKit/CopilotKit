"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useHitlInAppSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Approve refund for #12345",
        message:
          "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge.",
      },
      {
        title: "Downgrade plan for #12346",
        message:
          "Please downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle.",
      },
      {
        title: "Escalate ticket #12347",
        message:
          "Please escalate ticket #12347 to the payments team — Morgan Lee's payment is stuck.",
      },
    ],
    available: "always",
  });
}
