import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { skillComponents } from "@/a2ui/export/skills";
import { SiteHeader } from "@/components/site/site-header";
import { skillPresets } from "@/components/skills/presets";
import { SkillBuilder } from "@/components/skills/skill-builder";
import { CodeBlock } from "@/components/start/code-block";

export const metadata: Metadata = {
  title: "Skills | A2UI Playground",
  description:
    "Build an agent skill from the playground's A2UI 1.0 catalog with Google's A2UI TypeScript SDK: pick the components and macros, say when to use each, download it, then evaluate it.",
};

function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded-[5px] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em] text-foreground">{children}</code>;
}

const GENERATE = `import { CatalogConfig, ExpressFormat, SkillGenerator } from "@a2ui/agent";

// Your catalog as an A2UI v1.0 document, e.g. from CopilotKit's exportA2UICatalog(ui).
const { catalog } = CatalogConfig.fromPath("catalog.json");

new SkillGenerator(new ExpressFormat([catalog]))
  .generateSkillSet() // a2ui-core + one skill per catalog
  .exportToDirectory(".claude/skills");`;

const CONTENTS = [
  ["a2ui-core", "How to write A2UI in the chosen format: Express grammar or the JSON message rules. The same for every skill."],
  ["SKILL.md", "The components and macros you pick, each with its exact signature, the design rules that say when to use which, your own notes, and worked examples."],
  ["catalog.json", "The catalog narrowed to your pick, so an agent can compile Express or validate JSON with an A2UI SDK before anything renders."],
];

export default function SkillsPage() {
  const components = skillComponents();
  return (
    <div className="pg-root min-h-[100dvh] bg-black">
      <SiteHeader active="skills" />
      <main>
        <section className="landing-container pb-12 pt-20">
          <h1 className="max-w-[20ch] text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">Take the catalog to your own agent</h1>
          <p className="mt-5 max-w-[66ch] text-[16px] leading-relaxed text-muted-foreground">
            Google&apos;s A2UI TypeScript SDK, <C>@a2ui/agent</C>, compiles a catalog into agent skills, as the Python SDK does. Pick the components and macros your agent
            needs, say when to use them, and download the skill. Drop it into Claude Code, an ADK agent or Gemini CLI, point it at a renderer of the catalog, and it composes
            UI the way the playground does. Then{" "}
            <Link href="/evals" className="text-foreground underline underline-offset-4">
              evaluate it
            </Link>
            .
          </p>
          <ul className="mt-10 grid gap-3 md:grid-cols-3">
            {CONTENTS.map(([name, body]) => (
              <li key={name} className="rounded-xl border border-border bg-white/[0.02] px-5 py-4">
                <span className="font-mono text-[14px] text-foreground">{name}</span>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-16">
            <SkillBuilder components={components} presets={skillPresets(components)} />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="landing-container grid gap-8 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">Generate skills for your catalog</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                Export the catalog with <C>exportA2UICatalog(ui)</C> from <C>@copilotkit/react-core/v2/generative-ui</C>, then run the SDK&apos;s generator. In
                this repo, <C>pnpm skills:export</C> does both and writes the whole-catalog skill to <C>skills/generated/</C>.
              </p>
              <Link href="/start" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground">
                Use the catalog in your app <ArrowRight className="size-4" />
              </Link>
            </div>
            <CodeBlock code={GENERATE} file="generate-skills.ts" />
          </div>
        </section>
      </main>
    </div>
  );
}
