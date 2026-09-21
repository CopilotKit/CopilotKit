import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
/** Canonical LGP authored controls. Shared by every integration's acceptance test. */
import type {
  ConversationTurn,
  PillAction,
} from "../helpers/conversation-runner.js";
import type { D5FeatureType } from "../helpers/d5-registry.js";

type Contract = {
  label: string;
  prompt: string;
  expected: "unestablished" | "prime" | "voice" | "image" | "pdf";
  submission?: PillAction["submission"];
};
const SONNET: Contract = {
  label: "Write a sonnet",
  prompt: "Write a short sonnet about AI.",
  expected: "unestablished",
};
const PRIME: Contract = {
  label: "Is 17 prime?",
  prompt: "Walk me through whether 17 is prime.",
  expected: "prime",
};
export const CHAT_PLATFORM_CONTRACTS: Partial<
  Record<D5FeatureType, readonly Contract[]>
> = {
  "agentic-chat": [
    SONNET,
    {
      label: "Tell me a joke",
      prompt: "Tell me a one-line joke.",
      expected: "unestablished",
    },
    PRIME,
  ],
  "chat-slots": [
    SONNET,
    {
      label: "Tell me a joke",
      prompt: "Tell me a short joke.",
      expected: "unestablished",
    },
  ],
  "prebuilt-sidebar": [
    { label: "Say hi", prompt: "Say hi!", expected: "unestablished" },
    {
      label: "Fun fact",
      prompt: "Give me a fun fact.",
      expected: "unestablished",
    },
    PRIME,
  ],
  "prebuilt-popup": [
    {
      label: "Say hi",
      prompt: "Say hi from the popup!",
      expected: "unestablished",
    },
    {
      label: "Limerick",
      prompt: "Write me a quick limerick.",
      expected: "unestablished",
    },
    PRIME,
  ],
  voice: [
    {
      label: "Try a sample audio",
      prompt: "What is the weather in Tokyo?",
      expected: "voice",
      submission: {
        kind: "composer",
        expectedComposerText: "What is the weather in Tokyo?",
        sendButtonName: "",
        sendButtonTestId: "copilot-send-button",
      },
    },
  ],
  multimodal: [
    {
      label: "Try with sample image",
      prompt: "can you tell me what is in this demo image I just attached",
      expected: "image",
    },
    {
      label: "Try with sample PDF",
      prompt: "can you tell me what is in this demo pdf I just attached",
      expected: "pdf",
    },
  ],
};

/** Missing or unestablished canonical results are explicitly nonpassing. */
export function assertChatPlatformResult(
  expected: Contract["expected"],
  text: string,
): void {
  if (expected === "unestablished" || expected === "prime")
    throw new UnverifiedDefinitionError(
      "Canonical LGP expected result has not been established for this authored pill; nonempty text is not acceptance evidence",
    );
  // Exact LGP fixture oracles: aimock/d6/langgraph-python/voice.json and
  // harness/fixtures/d5/multimodal.json. Token presence cannot establish a
  // correct result: contradictory replies can contain every expected word.
  const replies = {
    voice:
      "The weather in Tokyo is currently 22°C with partly cloudy skies and light easterly winds.",
    image:
      "The attached image is the CopilotKit logo — a clean, geometric mark used across CopilotKit branding.",
    pdf: "The attached PDF document is the CopilotKit Quickstart guide. It walks through installing the React packages, configuring the CopilotKit provider, and adding a CopilotKit chat component to an application.",
  };
  const normalizeWhitespace = (value: string) =>
    value.replace(/\s+/gu, " ").trim();
  if (normalizeWhitespace(text) !== normalizeWhitespace(replies[expected]))
    throw new Error(
      `Canonical ${expected} reply differs from the established LGP fixture result`,
    );
}

export function buildChatPlatformTurns(
  feature: D5FeatureType,
): ConversationTurn[] {
  const contracts = CHAT_PLATFORM_CONTRACTS[feature];
  if (!contracts?.length)
    throw new UnverifiedDefinitionError(
      `${feature}: NO_AUTHORED_CANONICAL_PILL — functional acceptance cannot use a typed substitute`,
    );
  return contracts.map((contract, index) => ({
    input: contract.prompt,
    preFill: async (page) => {
      const selector =
        feature === "voice"
          ? '[data-testid="voice-sample-audio-button"]'
          : feature === "multimodal"
            ? '[data-testid="multimodal-sample-row"] button'
            : '[data-testid="copilot-suggestion"]';
      await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
      const actual = await page.evaluate((query) => {
        const doc = (
          globalThis as unknown as {
            document: {
              querySelectorAll(selector: string): ArrayLike<{
                textContent: string | null;
                getClientRects(): ArrayLike<unknown>;
                querySelectorAll(
                  selector: string,
                ): ArrayLike<{ textContent: string | null }>;
              }>;
            };
          }
        ).document;
        return Array.from(doc.querySelectorAll(query ?? ""))
          .filter((node) => node.getClientRects().length > 0)
          .map((node) => {
            const labels = node.querySelectorAll("span:not([aria-hidden])");
            return (
              (labels.length === 1
                ? labels[0]!.textContent
                : node.textContent
              )?.trim() ?? ""
            );
          });
      }, selector);
      const expected = contracts.map((item) => item.label);
      if (
        JSON.stringify([...actual].sort()) !==
        JSON.stringify([...expected].sort())
      )
        throw new Error(
          `${feature}: canonical pill inventory mismatch; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    },
    action: {
      kind: "pill",
      id: `${feature}-${index + 1}`,
      buttonName: contract.label,
      expectedDispatchedPrompt: contract.prompt,
      submission: contract.submission ?? { kind: "immediate" },
    },
    assertions: async (page, assistant) => {
      assertChatPlatformResult(contract.expected, assistant.text);
      if (feature === "chat-slots")
        await page.waitForSelector(
          '[data-slot-label="MessageView.AssistantMessage"]',
          { state: "visible", timeout: 5000 },
        );
      if (feature === "prebuilt-sidebar" || feature === "prebuilt-popup") {
        const root =
          feature === "prebuilt-sidebar"
            ? ".copilotKitSidebar"
            : ".copilotKitPopup";
        await page.waitForSelector(
          `${root} [data-testid="copilot-assistant-message"]`,
          { state: "visible", timeout: 5000 },
        );
      }
    },
  }));
}
