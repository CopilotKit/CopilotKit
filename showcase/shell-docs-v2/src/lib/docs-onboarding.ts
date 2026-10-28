import { z } from "zod";
import { FRONTENDS, FRAMEWORKS } from "@/proto/data";
import {
  frontendSchema,
  frameworkSchema,
  guideRequestSchema,
  resolveDocsGuideRequest,
  type DocsGuideId,
} from "./docs-chat-guides";

export const onboardingSnapshotSchema = z.object({
  goal: z.string().trim().max(240),
  frontend: frontendSchema.nullable(),
  framework: frameworkSchema.nullable(),
  notes: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        detail: z.string().trim().min(1).max(300),
      }),
    )
    .max(6),
});

export type OnboardingSnapshot = z.infer<typeof onboardingSnapshotSchema>;
export type OnboardingGuide = OnboardingSnapshot & {
  guides: {
    id: DocsGuideId;
    title: string;
    description: string;
    url: string;
  }[];
};

/** Structural subset of AG-UI messages; no React or runtime dependency. */
export type OnboardingMessage = {
  role: string;
  content?: unknown;
  toolCallId?: string;
  error?: unknown;
  toolCalls?: readonly {
    id: string;
    function: { name: string; arguments: string };
  }[];
};

const choiceArgsSchema = z.object({
  kind: z.enum(["frontend", "framework"]),
  choices: z.array(z.string()),
});
const choiceResultSchema = z.object({
  kind: z.enum(["frontend", "framework"]),
  selection: z.string().nullable(),
});
const confirmedGuideSchema = z.object({ id: z.string(), url: z.string() });

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Rebuild the current record from successful, completed tool calls only. */
export function deriveOnboardingGuide(
  messages: readonly OnboardingMessage[],
): OnboardingGuide {
  let snapshot: OnboardingSnapshot = {
    goal: "",
    frontend: null,
    framework: null,
    notes: [],
  };
  const calls = new Map<string, { name: string; args: unknown }>();
  const completed = new Set<string>();
  const guides = new Map<
    string,
    {
      guide: OnboardingGuide["guides"][number];
      frontend: z.infer<typeof frontendSchema>;
      framework: string;
    }
  >();

  const isGlobal = (id: DocsGuideId) => id === "streams" || id === "learning";
  const compatible = (entry: { frontend: string; framework: string }) =>
    (!snapshot.frontend || snapshot.frontend === entry.frontend) &&
    (!snapshot.framework || snapshot.framework === entry.framework);
  const applySnapshot = (next: OnboardingSnapshot) => {
    const clearedStack =
      (snapshot.frontend !== null && next.frontend === null) ||
      (snapshot.framework !== null && next.framework === null);
    snapshot = next;
    for (const [url, entry] of guides) {
      if (!isGlobal(entry.guide.id) && (clearedStack || !compatible(entry)))
        guides.delete(url);
    }
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        calls.set(call.id, {
          name: call.function.name,
          args: parseJson(call.function.arguments),
        });
      }
      continue;
    }
    if (
      message.role !== "tool" ||
      !message.toolCallId ||
      message.error ||
      completed.has(message.toolCallId)
    )
      continue;
    const call = calls.get(message.toolCallId);
    if (!call) continue;
    const result = parseJson(message.content);

    if (call.name === "update_onboarding") {
      const args = onboardingSnapshotSchema.safeParse(call.args);
      const update = onboardingSnapshotSchema.safeParse(result);
      if (!args.success || !update.success) continue;
      applySnapshot(update.data);
    } else if (call.name === "choose_docs_stack") {
      const args = choiceArgsSchema.safeParse(call.args);
      const choice = choiceResultSchema.safeParse(result);
      if (
        !args.success ||
        !choice.success ||
        args.data.kind !== choice.data.kind
      )
        continue;
      const { kind, selection } = choice.data;
      if (selection === null) continue;
      if (!args.data.choices.includes(selection)) continue;
      if (kind === "frontend") {
        const frontend = frontendSchema.safeParse(selection);
        if (!frontend.success) continue;
        applySnapshot({ ...snapshot, frontend: frontend.data });
      } else {
        const framework = frameworkSchema.safeParse(selection);
        if (!framework.success) continue;
        applySnapshot({ ...snapshot, framework: framework.data });
      }
    } else if (call.name === "recommend_guides") {
      const request = guideRequestSchema.safeParse(call.args);
      const confirmed = z.array(confirmedGuideSchema).safeParse(result);
      if (!request.success || !confirmed.success) continue;
      for (const guide of resolveDocsGuideRequest(request.data)) {
        if (
          !confirmed.data.some(
            (item) => item.id === guide.id && item.url === guide.url,
          )
        )
          continue;
        const entry = {
          guide,
          frontend: request.data.frontend,
          framework: request.data.framework,
        };
        // A recommendation may complete before its stack-confirming snapshot.
        // Keep the candidate until final filtering; set preserves first-seen order.
        guides.set(guide.url, entry);
      }
    }
    completed.add(message.toolCallId);
  }

  return {
    ...snapshot,
    guides: [...guides.values()]
      .filter((entry) => isGlobal(entry.guide.id) || compatible(entry))
      .map((entry) => entry.guide),
  };
}

const markdownText = (text: string) => text.replace(/[\\`*_{}[\]<>#]/g, "\\$&");

/** A portable record for the reader or their coding agent. */
export function onboardingGuideToMarkdown(guide: OnboardingGuide): string {
  const sections = ["# Onboarding guide"];
  if (guide.goal) sections.push(markdownText(guide.goal));
  const stack = [
    guide.frontend
      ? `- Frontend: ${FRONTENDS.find((item) => item.id === guide.frontend)?.name ?? guide.frontend}`
      : null,
    guide.framework
      ? `- Agent: ${FRAMEWORKS.find((item) => item.id === guide.framework)?.name ?? guide.framework}`
      : null,
  ].filter(Boolean);
  if (stack.length) sections.push(`## Stack\n\n${stack.join("\n")}`);
  if (guide.notes.length)
    sections.push(
      guide.notes
        .map(
          (note) =>
            `### ${markdownText(note.title)}\n\n${markdownText(note.detail)}`,
        )
        .join("\n\n"),
    );
  if (guide.guides.length)
    sections.push(
      `## Guides\n\n${guide.guides.map((item) => `- [${markdownText(item.title)}](https://docs.copilotkit.ai${item.url}): ${markdownText(item.description)}`).join("\n")}`,
    );
  return sections.join("\n\n");
}
