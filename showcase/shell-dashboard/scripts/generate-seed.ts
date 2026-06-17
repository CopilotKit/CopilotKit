#!/usr/bin/env tsx
/**
 * generate-seed.ts — Generates baseline-seed.json from hardcoded Notion data.
 *
 * Run: npx tsx scripts/generate-seed.ts
 * Output: src/data/baseline-seed.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseNotionData, type SeedEntry } from "../src/lib/baseline-parse";
import {
  BASELINE_PARTNERS,
  FEATURE_CATEGORIES,
} from "../src/lib/baseline-types";

/* ------------------------------------------------------------------ */
/*  Feature display names (reverse-lookup from slug → display name)    */
/* ------------------------------------------------------------------ */

const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  "beautiful-chat": "Beautiful Chat",
  "pre-built-copilotchat": "Pre-built: CopilotChat",
  "pre-built-sidebar": "Pre-built: Sidebar",
  "pre-built-popup": "Pre-built: Popup",
  "chat-customization-slots": "Chat Customization (Slots)",
  "chat-customization-css": "Chat Customization (CSS)",
  "headless-chat-simple": "Headless Chat (Simple)",
  "headless-chat-complete": "Headless Chat (Complete)",
  "controlled-gen-ui-display": "Controlled Gen UI Display",
  "declarative-generative-ui-a2ui-dynamic-schema":
    "Declarative Generative UI — A2UI Dynamic Schema",
  "declarative-generative-ui-a2ui-fixed-schema":
    "Declarative Generative UI — A2UI Fixed Schema",
  "mcp-apps": "MCP Apps",
  "fully-open-ended-generative-ui": "Fully Open-Ended Generative UI",
  "open-ended-gen-ui-advanced-with-frontend-function-calling":
    "Open-Ended Gen UI Advanced (with Frontend Function Calling)",
  "tool-rendering-default-catch-all": "Tool Rendering (Default Catch-All)",
  "tool-rendering-custom-catch-all": "Tool Rendering (Custom Catch-All)",
  "tool-rendering": "Tool Rendering",
  "in-chat-hitl-usehumanintheloop-ergonomic-api":
    "In-Chat HITL useHumanInTheLoop (Ergonomic API)",
  "in-chat-hitl-booking": "In-Chat HITL Booking",
  "in-chat-human-in-the-loop-original": "In-Chat Human in the Loop (Original)",
  "in-app-human-in-the-loop-frontend-tools-async-hitl":
    "In-App Human in the Loop (Frontend Tools Async HITL)",
  "in-chat-hitl-useinterrupt-low-level-primitive":
    "In-Chat HITL useInterrupt (Low-Level Primitive)",
  reasoning: "Reasoning",
  "file-attachments": "File Attachments",
  "shared-state-read-write": "Shared State (Read + Write)",
  "agentic-generative-ui-in-chat-state-rendering":
    "Agentic Generative UI — In-Chat State Rendering",
  "state-streaming": "State Streaming",
  "frontend-tools-in-app-actions": "Frontend Tools (In-App Actions)",
  "frontend-tools-async": "Frontend Tools (Async)",
  "readonly-state-agent-context": "ReadOnly State (Agent Context)",
  "sub-agents": "Sub-Agents",
  "byoc-hashbrown": "BYOC Hashbrown",
  "byoc-json-render": "BYOC JSON Render",
};

/* ------------------------------------------------------------------ */
/*  Partner names list (ordered as in BASELINE_PARTNERS)               */
/* ------------------------------------------------------------------ */

const PARTNER_NAMES = BASELINE_PARTNERS.map((p) => p.name);

/* ------------------------------------------------------------------ */
/*  Feature slugs from FEATURE_CATEGORIES                              */
/* ------------------------------------------------------------------ */

const ALL_FEATURE_SLUGS = Object.values(FEATURE_CATEGORIES).flat();

/* ------------------------------------------------------------------ */
/*  Partners that get 🛠️ [ALL] for everything                         */
/* ------------------------------------------------------------------ */

const ALL_PARTNERS = new Set(["Cloudflare", "OpenAI Agents SDK", "n8n"]);

/* ------------------------------------------------------------------ */
/*  Features where LangChain-Python is ✅ and most others are          */
/*  🛠️ [DEMO] [DOCS] [TEST]  (Generative UI cluster)                  */
/* ------------------------------------------------------------------ */

const GEN_UI_FEATURES = new Set([
  "controlled-gen-ui-display",
  "declarative-generative-ui-a2ui-dynamic-schema",
  "declarative-generative-ui-a2ui-fixed-schema",
  "mcp-apps",
  "fully-open-ended-generative-ui",
  "open-ended-gen-ui-advanced-with-frontend-function-calling",
  "tool-rendering-default-catch-all",
  "tool-rendering-custom-catch-all",
  "tool-rendering",
]);

/* ------------------------------------------------------------------ */
/*  Features that are ✅ across most partners                          */
/* ------------------------------------------------------------------ */

const WORKS_FEATURES = new Set([
  "pre-built-copilotchat",
  "pre-built-sidebar",
  "pre-built-popup",
  "shared-state-read-write",
  "readonly-state-agent-context",
  "state-streaming",
]);

/* ------------------------------------------------------------------ */
/*  BYOC features — 🛠️ [ALL] for everyone                             */
/* ------------------------------------------------------------------ */

const BYOC_FEATURES = new Set(["byoc-hashbrown", "byoc-json-render"]);

/* ------------------------------------------------------------------ */
/*  Build the Notion snapshot rows                                     */
/* ------------------------------------------------------------------ */

function buildNotionRows(): Record<string, string>[] {
  const rows: Record<string, string>[] = [];

  for (const featureSlug of ALL_FEATURE_SLUGS) {
    const displayName = FEATURE_DISPLAY_NAMES[featureSlug];
    if (!displayName) {
      throw new Error(`Missing display name for feature slug: ${featureSlug}`);
    }

    const row: Record<string, string> = {
      "Feature / Capability": displayName,
    };

    for (const partnerName of PARTNER_NAMES) {
      row[partnerName] = getCellValue(featureSlug, partnerName);
    }

    rows.push(row);
  }

  return rows;
}

function getCellValue(featureSlug: string, partner: string): string {
  // BYOC features → 🛠️ [ALL] for everyone
  if (BYOC_FEATURES.has(featureSlug)) {
    return "🛠️ [ALL]";
  }

  // ALL-tagged partners → 🛠️ [ALL] for everything
  if (ALL_PARTNERS.has(partner)) {
    return "🛠️ [ALL]";
  }

  // Features that work across most partners
  if (WORKS_FEATURES.has(featureSlug)) {
    return "✅";
  }

  // Gen UI features: LangChain-Python = ✅, others = 🛠️ [DEMO] [DOCS] [TEST]
  if (GEN_UI_FEATURES.has(featureSlug)) {
    if (partner === "LangChain - Python") {
      return "✅";
    }
    return "🛠️ [DEMO] [DOCS] [TEST]";
  }

  // HITL features: mostly 🛠️ [DEMO]
  if (
    featureSlug.startsWith("in-chat-hitl") ||
    featureSlug.startsWith("in-app-human") ||
    featureSlug === "in-chat-human-in-the-loop-original"
  ) {
    if (partner === "LangChain - Python") {
      return "✅";
    }
    if (partner === "Google ADK" || partner === "CrewAI") {
      return "❌ [INT]";
    }
    return "🛠️ [DEMO]";
  }

  // Beautiful Chat → 🛠️ [DEMO] for most, ✅ for top frameworks
  if (featureSlug === "beautiful-chat") {
    if (
      partner === "LangChain - Python" ||
      partner === "LangChain - TypeScript" ||
      partner === "Mastra" ||
      partner === "Built-in Agent"
    ) {
      return "✅";
    }
    return "🛠️ [DEMO]";
  }

  // Chat customization → 🛠️ [CPK] for most
  if (
    featureSlug === "chat-customization-slots" ||
    featureSlug === "chat-customization-css"
  ) {
    if (partner === "LangChain - Python" || partner === "Built-in Agent") {
      return "✅";
    }
    return "🛠️ [CPK]";
  }

  // Headless chat → 🛠️ [CPK] [AG-UI] for most
  if (
    featureSlug === "headless-chat-simple" ||
    featureSlug === "headless-chat-complete"
  ) {
    if (partner === "LangChain - Python") {
      return "✅";
    }
    return "🛠️ [CPK] [AG-UI]";
  }

  // Reasoning → ✅ for LangChain-Python, ❓ for a few, 🛠️ [DEMO] for rest
  if (featureSlug === "reasoning") {
    if (partner === "LangChain - Python") return "✅";
    if (partner === "AG2" || partner === "Langroid") return "❓";
    return "🛠️ [DEMO]";
  }

  // File attachments → 🛠️ [CPK] for most
  if (featureSlug === "file-attachments") {
    if (partner === "LangChain - Python" || partner === "Built-in Agent") {
      return "✅";
    }
    return "🛠️ [CPK]";
  }

  // Agentic gen UI → 🛠️ [DEMO] [DOCS] for most
  if (featureSlug === "agentic-generative-ui-in-chat-state-rendering") {
    if (partner === "LangChain - Python") return "✅";
    return "🛠️ [DEMO] [DOCS]";
  }

  // Frontend tools → 🛠️ [DEMO] for most
  if (
    featureSlug === "frontend-tools-in-app-actions" ||
    featureSlug === "frontend-tools-async"
  ) {
    if (partner === "LangChain - Python" || partner === "Mastra") return "✅";
    return "🛠️ [DEMO]";
  }

  // Sub-agents → 🛠️ [INT] for most
  if (featureSlug === "sub-agents") {
    if (partner === "LangChain - Python") return "✅";
    if (partner === "CrewAI" || partner === "AG2") return "❌ [INT]";
    return "🛠️ [INT]";
  }

  // Default fallback: 🛠️ [DEMO]
  return "🛠️ [DEMO]";
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const rows = buildNotionRows();
const entries = parseNotionData(rows, PARTNER_NAMES);

// Verify expected count
const expectedCount = ALL_FEATURE_SLUGS.length * PARTNER_NAMES.length;
if (entries.length !== expectedCount) {
  console.error(`Expected ${expectedCount} entries but got ${entries.length}`);
  process.exit(1);
}

const outPath = path.resolve(__dirname, "../src/data/baseline-seed.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");

console.log(
  `Wrote ${entries.length} entries (${ALL_FEATURE_SLUGS.length} features × ${PARTNER_NAMES.length} partners) to ${outPath}`,
);
