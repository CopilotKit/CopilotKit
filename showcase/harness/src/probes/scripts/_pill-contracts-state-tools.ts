/** Canonical LGP controls and visible results, shared by every integration.
 * Unestablished result oracles remain explicit failures; they never count as acceptance.
 */
import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export interface StateToolsContract {
  id: string;
  buttonName: string;
  prompt: string;
  selector: string;
  texts: readonly string[];
  attribute?: string;
  value?: string;
  unresolved?: string;
  noteIds?: readonly string[];
  noteRows?: readonly string[];
}
export const STATE_TOOLS_CONTRACTS = {
  "frontend-tools": [
    {
      id: "sunset",
      buttonName: "Sunset theme",
      prompt: "Make the background a sunset gradient.",
      selector: '[data-testid="frontend-tools-background"]',
      texts: [],
      attribute: "data-background-value",
      value: "linear-gradient(135deg, #ff7e5f 0%, #feb47b 50%, #ff6b6b 100%)",
    },
    {
      id: "forest",
      buttonName: "Forest theme",
      prompt: "Switch to a deep green forest gradient.",
      selector: '[data-testid="frontend-tools-background"]',
      texts: [],
      attribute: "data-background-value",
      value: "linear-gradient(135deg, #0a3d2e 0%, #166534 50%, #059669 100%)",
    },
    {
      id: "cosmic",
      buttonName: "Cosmic theme",
      prompt: "Make it a navy → magenta cosmic gradient.",
      selector: '[data-testid="frontend-tools-background"]',
      texts: [],
      attribute: "data-background-value",
      value: "linear-gradient(135deg, #1e3a8a 0%, #6b21a8 50%, #9333ea 100%)",
    },
  ],
  "frontend-tools-async": [
    {
      id: "project-planning",
      noteRows: [
        "Q2 project planning kickoff Discussed scope for the new onboarding flow with design. Draft spec due Friday. planning project onboarding",
        "Project planning retrospective notes What went well: async standups. What didn't: ambiguous ownership on shared components. retro project planning",
      ],
      noteIds: ["note-n1", "note-n5"],
      buttonName: "Find project-planning notes",
      prompt: "Find my notes about project planning.",
      selector: '[data-testid="notes-card"]',
      texts: [
        "Matching “project planning”",
        "2 matches",
        "Q2 project planning kickoff",
        "Discussed scope for the new onboarding flow with design. Draft spec due Friday.",
        "Project planning retrospective notes",
        "What went well: async standups. What didn't: ambiguous ownership on shared components.",
      ],
    },
    {
      id: "auth",
      noteRows: [
        "Planning: migrate auth to passkeys Research WebAuthn library options. Consider fallback for unsupported browsers. planning auth security",
      ],
      noteIds: ["note-n2"],
      buttonName: "Search for 'auth'",
      prompt: "Search my notes for anything related to auth.",
      selector: '[data-testid="notes-card"]',
      texts: [
        "Matching “auth”",
        "1 match",
        "Planning: migrate auth to passkeys",
        "Research WebAuthn library options. Consider fallback for unsupported browsers.",
      ],
    },
    {
      id: "reading",
      noteRows: [
        "Book recommendations Thinking Fast and Slow (Kahneman); The Design of Everyday Things (Norman). reading",
      ],
      noteIds: ["note-n4"],
      buttonName: "What do I have about reading?",
      prompt: "Do I have any notes tagged reading?",
      selector: '[data-testid="notes-card"]',
      texts: [
        "Matching “reading”",
        "1 match",
        "Book recommendations",
        "Thinking Fast and Slow (Kahneman); The Design of Everyday Things (Norman).",
        "reading",
      ],
    },
  ],
  "readonly-state-context": [
    {
      id: "who-am-i",
      buttonName: "Who am I?",
      prompt: "What do you know about me from my context?",
      selector: '[data-testid="copilot-assistant-message"]',
      texts: [
        "Based on your context I can see your name and recent activity. I'll keep responses calibrated to your timezone.",
      ],
    },
    {
      id: "next-steps",
      buttonName: "Suggest next steps",
      prompt: "Based on my recent activity, what should I try next?",
      selector: "",
      texts: [],
      unresolved:
        "Canonical LGP next-steps visible result has not been established.",
    },
    {
      id: "morning",
      buttonName: "Plan my morning",
      prompt:
        "What time is it in my timezone and what should I do for the next hour?",
      selector: "",
      texts: [],
      unresolved:
        "Canonical LGP morning-plan visible result has not been established.",
    },
  ],
  "shared-state-read": [
    {
      id: "italian",
      buttonName: "Create Italian recipe",
      prompt: "Create a delicious Italian pasta recipe.",
      selector: '[data-testid="copilot-assistant-message"]',
      texts: [
        "Great choice — looking at your current recipe state, I'd build an Italian pasta around the existing ingredients: a quick spaghetti aglio e olio, finishing with parmesan and a squeeze of lemon. Want me to suggest substitutions or adjust the cooking time?",
      ],
    },
    {
      id: "healthier",
      buttonName: "Make it healthier",
      prompt: "Make the recipe healthier with more vegetables.",
      selector: '[data-testid="copilot-assistant-message"]',
      texts: [
        "Here are a few healthier ingredient additions for the recipe: roasted bell peppers, baby spinach folded in at the end, and cherry tomatoes for brightness. The Italian flavor profile holds up well, and the vegetable swap keeps the dish lighter without losing the comfort of pasta.",
      ],
    },
    {
      id: "variations",
      buttonName: "Suggest variations",
      prompt: "Suggest some creative variations of this recipe.",
      selector: "",
      texts: [],
      unresolved:
        "Canonical LGP recipe-variations visible result has not been established.",
    },
  ],
  "shared-state-streaming": [
    {
      id: "poem",
      buttonName: "Write a short poem",
      prompt: "Write a short poem about autumn leaves.",
      selector: '[data-testid="document-content"]',
      texts: [
        "Crimson and amber in slow descent, / each leaf a quiet ledger of summer spent. / The wind, a courier with nothing to say, / files them gently into the morning's gray. / Somewhere a kettle hums, and afternoons grow brief — / autumn keeps its books in vermilion and gold leaf.",
      ],
    },
    {
      id: "email",
      buttonName: "Draft an email",
      prompt:
        "Draft a polite email declining a meeting next Tuesday afternoon.",
      selector: '[data-testid="document-content"]',
      texts: [
        "Hi — thanks for sending the invite for Tuesday afternoon. Unfortunately I won't be able to make it this week. I'd love to find time later in the month if your schedule allows. In the meantime, feel free to send any pre-reads my way and I'll review them async so we don't lose momentum. Best, [name]",
      ],
    },
    {
      id: "quantum",
      buttonName: "Explain quantum computing",
      prompt:
        "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
      selector: '[data-testid="document-content"]',
      texts: [
        "A regular computer stores information in bits — tiny switches that are either on (1) or off (0). A quantum computer uses qubits, which can sit in a fuzzy superposition of both states at once until you check them. Stack many qubits together and they can explore lots of possibilities in parallel, which is why people are excited.\n\nThis doesn't make quantum computers faster at everything. They're great at problems with hidden structure — like factoring big numbers, simulating molecules, or searching certain databases — but useless for, say, opening Excel. Today's machines are noisy and small, so we mostly use them to test ideas rather than replace your laptop.",
      ],
    },
  ],
  "shared-state-write": [
    {
      id: "greet",
      buttonName: "Greet me",
      prompt: "Say hi and introduce yourself.",
      selector: '[data-testid="copilot-assistant-message"]',
      texts: [
        "Hi — I'm your shared-state co-pilot. Your Preferences panel (name, tone, language, interests) is fed to me on every turn, and I jot notes back into the Agent Scratch Pad via set_notes so the UI re-renders. Try setting your name or asking me to remember something.",
      ],
    },
    {
      id: "remember",
      buttonName: "Remember something",
      prompt:
        "Remember that I prefer morning meetings and that I don't eat dairy.",
      selector: "",
      texts: [],
      unresolved:
        "Canonical LGP remembered morning-meeting and dairy notes have not been established.",
    },
    {
      id: "weekend",
      buttonName: "Plan a weekend",
      prompt: "Suggest a weekend plan based on my interests.",
      selector: '[data-testid="copilot-assistant-message"]',
      texts: [
        "A weekend tailored to your interests panel: if you haven't picked any yet, try Cooking + Travel for a market-and-day-trip combo, or Tech + Books for a maker session and a long reading afternoon. Add interests in the Preferences panel and re-ask for a more specific plan.",
      ],
    },
  ],
} as const satisfies Record<string, readonly StateToolsContract[]>;
export type StateToolsFeature = keyof typeof STATE_TOOLS_CONTRACTS;
export const STATE_TOOLS_ROUTES: Record<StateToolsFeature, string> = {
  "frontend-tools": "/demos/frontend-tools",
  "frontend-tools-async": "/demos/frontend-tools-async",
  "readonly-state-context": "/demos/readonly-state-agent-context",
  "shared-state-read": "/demos/shared-state-read",
  "shared-state-streaming": "/demos/shared-state-streaming",
  "shared-state-write": "/demos/shared-state-read-write",
};

interface VisibleResult {
  texts: string[];
  attributes: (string | null)[];
  pills: string[];
  noteIds: string[][];
  noteRows: string[][];
  backgroundMatches: boolean[];
}
async function readVisibleResult(
  page: Page,
  contract: StateToolsContract,
): Promise<VisibleResult> {
  // This Node-only harness intentionally excludes lib.dom. The serialized function
  // executes exclusively in the real browser, matching the P1 assertion convention.
  const read = new Function(`
    const visible = el => el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const nodes = ${JSON.stringify(contract.selector)} ? Array.from(document.querySelectorAll(${JSON.stringify(contract.selector)})).filter(visible) : [];
    return {
      texts: nodes.map(el => el.innerText),
      noteRows: nodes.map(el => Array.from(el.querySelectorAll('[data-testid^="note-"]')).filter(visible).map(row => row.innerText)),
      backgroundMatches: nodes.map(el => { const reference = document.createElement("div"); reference.style.backgroundImage = ${JSON.stringify(contract.value ?? "")}; return getComputedStyle(el).backgroundImage === reference.style.backgroundImage; }),
      noteIds: nodes.map(el => Array.from(el.querySelectorAll('[data-testid^="note-"]')).filter(visible).map(row => row.getAttribute("data-testid"))),
      attributes: nodes.map(el => el.getAttribute(${JSON.stringify(contract.attribute ?? "data-unused")})),
      pills: Array.from(document.querySelectorAll('[data-slot="suggestion-pill"]')).filter(visible).map(el => el.textContent.trim())
    };
  `) as () => VisibleResult;
  return page.evaluate(read);
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function checkStateToolsResult(
  contract: StateToolsContract,
  actual: VisibleResult,
  baselineCount: number,
): void {
  if (contract.unresolved)
    throw new UnverifiedDefinitionError(contract.unresolved);
  if (!contract.selector || (!contract.attribute && !contract.texts.length))
    throw new Error(`${contract.id}: empty canonical result contract`);
  if (contract.attribute) {
    if (
      actual.attributes.length !== 1 ||
      actual.attributes[0] !== contract.value ||
      actual.backgroundMatches[0] !== true
    )
      throw new Error(
        `${contract.id}: expected exact background ${contract.value}; got ${JSON.stringify(actual.attributes)}`,
      );
    return;
  }
  const persistent = contract.selector === '[data-testid="document-content"]';
  const fresh = persistent ? actual.texts : actual.texts.slice(baselineCount);
  if (fresh.length !== 1)
    throw new Error(
      `${contract.id}: expected one fresh visible result, got ${fresh.length}`,
    );
  const text = normalize(fresh[0]!);
  if (contract.selector === '[data-testid="notes-card"]') {
    if (
      JSON.stringify(actual.noteIds.slice(baselineCount)) !==
      JSON.stringify([contract.noteIds])
    )
      throw new Error(`${contract.id}: exact note rows differ`);
    if (
      JSON.stringify(
        actual.noteRows
          .slice(baselineCount)
          .map((rows) => rows.map((row) => normalize(row).toLowerCase())),
      ) !==
      JSON.stringify([
        contract.noteRows?.map((row) => normalize(row).toLowerCase()),
      ])
    )
      throw new Error(
        `${contract.id}: exact note titles, excerpts, or tags differ`,
      );
    if (!contract.texts.every((value) => text.includes(normalize(value))))
      throw new Error(
        `${contract.id}: exact note result is missing required values: ${text}`,
      );
  } else if (text !== normalize(contract.texts[0]!)) {
    throw new Error(`${contract.id}: canonical visible text differs: ${text}`);
  }
}

export function buildStateToolsTurns(
  feature: StateToolsFeature,
): ConversationTurn[] {
  const contracts: readonly StateToolsContract[] =
    STATE_TOOLS_CONTRACTS[feature];
  return contracts.map((contract) => {
    let baselineCount = 0;
    return {
      input: contract.prompt,
      action: {
        kind: "pill",
        id: `${feature}:${contract.id}`,
        buttonName: contract.buttonName,
        expectedDispatchedPrompt: contract.prompt,
        submission: { kind: "immediate" },
      },
      preFill: async (page) => {
        await page.waitForSelector('[data-slot="suggestion-pill"]', {
          state: "visible",
          timeout: 15000,
        });
        const before = await readVisibleResult(page, contract);
        if (
          JSON.stringify(before.pills) !==
          JSON.stringify(contracts.map((pill) => pill.buttonName))
        )
          throw new Error(
            `${feature}: missing, extra, or reordered canonical pills: ${JSON.stringify(before.pills)}`,
          );
        baselineCount = before.texts.length;
      },
      assertions: async (page) => {
        const deadline = Date.now() + 15000;
        let failure: unknown;
        do {
          try {
            checkStateToolsResult(
              contract,
              await readVisibleResult(page, contract),
              baselineCount,
            );
            return;
          } catch (error) {
            failure = error;
          }
          if (contract.unresolved) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        throw failure;
      },
      responseTimeoutMs: 60000,
    };
  });
}
