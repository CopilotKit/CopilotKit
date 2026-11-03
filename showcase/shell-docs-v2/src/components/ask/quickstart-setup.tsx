"use client";

import { useState } from "react";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { Check } from "lucide-react";
import { z } from "zod";
import { FrameworkPicker } from "@/components/framework-picker";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEFAULT_FRAMEWORK,
  FRAMEWORKS,
  FRONTENDS,
  frameworkById,
  type FrontendId,
} from "@/proto/data";
import { useFrontend } from "@/proto/frontend";
import { useLastFramework } from "@/proto/last-framework";

/*
 * "Build your quickstart": before the agent writes a quickstart guide, it
 * asks the reader about their setup in the chat, with a human-in-the-loop
 * card (useHumanInTheLoop): the frontend, the agent framework, a new or an
 * existing app, and the features to start with. The answers go back to the
 * agent, which then writes the guide for exactly that setup.
 */

/** App frontends only; Slack and Teams are channels, with their own setup. */
const APP_FRONTENDS = FRONTENDS.filter((f) => f.kind === "app");

const FRAMEWORK_IDS = FRAMEWORKS.map((f) => f.id);

const STARTS = [
  { id: "new", label: "A new app" },
  { id: "existing", label: "An existing app" },
] as const;

/** What the guide covers after the base setup, in the docs' own terms. */
const FEATURES = [
  { id: "chat", label: "Chat" },
  { id: "generative-ui", label: "Generative UI" },
  { id: "frontend-tools", label: "Frontend tools" },
  { id: "shared-state", label: "Shared state" },
  { id: "human-in-the-loop", label: "Human approval" },
] as const;

type Start = (typeof STARTS)[number]["id"];
type Feature = (typeof FEATURES)[number]["id"];

const ids = <T extends { id: string }>(list: readonly T[]) =>
  list.map((item) => item.id) as [T["id"], ...T["id"][]];

const SETUP_PARAMS = z.object({
  frontend: z
    .enum(ids(APP_FRONTENDS))
    .optional()
    .describe("Your best guess from the reader's stack in the context"),
  agentFramework: z
    .enum(ids(FRAMEWORKS))
    .optional()
    .describe("Your best guess from the reader's stack in the context"),
  starting: z
    .enum(ids(STARTS))
    .optional()
    .describe("A new app, or adding CopilotKit to an existing one"),
  features: z
    .array(z.enum(ids(FEATURES)))
    .optional()
    .describe("The features they asked about, if any; chat if none"),
});

type Setup = z.infer<typeof SETUP_PARAMS>;

/** What the agent gets back: the reader's answers, by name. */
interface Answers {
  frontend: string;
  agentFramework: string;
  starting: string;
  features: string[];
}

/** One chip of a question: the docs' frontend chips (src/proto/pieces.tsx). */
const CHIP =
  "relative h-8 gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-accent hover:text-foreground aria-pressed:border-brand-lilac-mid aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-brand-lilac-mid dark:aria-pressed:border-brand-lilac dark:aria-pressed:ring-brand-lilac";

function Question({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-xs font-medium text-fd-muted-foreground">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * The setup card, in the chat. While the agent fills in its guesses the
 * card shows them, disabled; once it waits for the reader, the questions
 * take their answers; after "Build my quickstart" it folds to one line of
 * what they chose.
 */
function SetupCard({
  args,
  status,
  result,
  respond,
}: {
  args: Partial<Setup>;
  status: string;
  result?: string;
  respond?: (result: unknown) => Promise<void>;
}) {
  const { setFrontend } = useFrontend();
  const [, setFramework] = useLastFramework();
  const [frontend, setFrontendChoice] = useState<FrontendId | null>(null);
  const [framework, setFrameworkChoice] = useState<string | null>(null);
  const [starting, setStarting] = useState<Start | null>(null);
  const [features, setFeatures] = useState<Feature[] | null>(null);

  const chosen = {
    frontend: frontend ?? args.frontend ?? "react",
    framework: framework ?? args.agentFramework ?? DEFAULT_FRAMEWORK,
    starting: starting ?? args.starting ?? "new",
    features: features ?? (args.features?.length ? args.features : ["chat"]),
  };
  const live = status === "executing" && !!respond;

  if (status === "complete") {
    const answers = parseAnswers(result);
    return (
      <div className="my-2 flex w-full items-start gap-2 rounded-xl border border-fd-border px-3 py-2.5 text-xs leading-5 text-fd-muted-foreground">
        <Check
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-fd-primary"
        />
        <span className="min-w-0">
          {answers
            ? [
                answers.frontend,
                answers.agentFramework,
                answers.starting,
                answers.features.join(", "),
              ].join(" · ")
            : "Setup sent"}
        </span>
      </div>
    );
  }

  const submit = () => {
    if (!respond) return;
    const name = frameworkById(chosen.framework)?.name ?? chosen.framework;
    // The reader's own choice, so the docs follow it too.
    setFrontend(chosen.frontend);
    setFramework(chosen.framework);
    const answers: Answers = {
      frontend:
        APP_FRONTENDS.find((f) => f.id === chosen.frontend)?.name ??
        chosen.frontend,
      agentFramework: name,
      starting: STARTS.find((s) => s.id === chosen.starting)!.label,
      features: chosen.features.map(
        (id) => FEATURES.find((f) => f.id === id)!.label,
      ),
    };
    void respond(answers);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="my-2 flex w-full flex-col gap-5 rounded-xl border border-fd-border bg-fd-background p-4 motion-safe:animate-[rise-in_480ms_cubic-bezier(0.25,1,0.5,1)_both]"
    >
      <div>
        <p className="text-sm leading-6 font-semibold">Your setup</p>
        <p className="text-xs leading-5 text-fd-muted-foreground">
          Four answers, and the guide is written for exactly this.
        </p>
      </div>

      <Question label="Frontend">
        <ToggleGroup
          aria-label="Frontend"
          value={[chosen.frontend]}
          onValueChange={(v) => {
            if (v[0]) setFrontendChoice(v[0] as FrontendId);
          }}
          disabled={!live}
          variant="outline"
          spacing={1.5}
          className="flex-wrap"
        >
          {APP_FRONTENDS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className={CHIP}>
              <FrontendLogo icon={f.id} size={14} />
              {f.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Question>

      <Question label="Agent framework">
        <FrameworkPicker
          value={chosen.framework}
          frameworks={FRAMEWORK_IDS}
          onValueChange={setFrameworkChoice}
          disabled={!live}
          className="h-9 w-full max-w-72 bg-card"
        />
      </Question>

      <Question label="Starting from">
        <ToggleGroup
          aria-label="Starting from"
          value={[chosen.starting]}
          onValueChange={(v) => {
            if (v[0]) setStarting(v[0] as Start);
          }}
          disabled={!live}
          variant="outline"
          spacing={1.5}
          className="flex-wrap"
        >
          {STARTS.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id} className={CHIP}>
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Question>

      <Question label="Start with">
        <ToggleGroup
          aria-label="Start with"
          multiple
          value={chosen.features}
          onValueChange={(v) => {
            if (v.length) setFeatures(v as Feature[]);
          }}
          disabled={!live}
          variant="outline"
          spacing={1.5}
          className="flex-wrap"
        >
          {FEATURES.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className={CHIP}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Question>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!live}
          className="h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/85 max-md:h-11"
        >
          Build my quickstart
        </Button>
      </div>
    </form>
  );
}

/** The answers in a finished call's result, if it holds them. */
function parseAnswers(result?: string): Answers | null {
  if (!result) return null;
  try {
    const value = JSON.parse(result) as Partial<Answers>;
    return value.frontend && value.agentFramework && value.starting
      ? {
          frontend: value.frontend,
          agentFramework: value.agentFramework,
          starting: value.starting,
          features: Array.isArray(value.features) ? value.features : [],
        }
      : null;
  } catch {
    return null;
  }
}

/** Registers the setup questions as the agent's `ask_quickstart_setup`. */
export function useQuickstartSetup() {
  useHumanInTheLoop({
    name: "ask_quickstart_setup",
    description:
      "Ask the reader about their setup before writing their quickstart guide: the frontend, the agent framework, a new or an existing app, and the features to start with. Pass your best guesses as defaults. Returns their answers.",
    parameters: SETUP_PARAMS,
    render: SetupCard as never,
  });
}
