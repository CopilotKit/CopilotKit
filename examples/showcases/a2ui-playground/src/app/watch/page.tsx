import fs from "node:fs";
import path from "node:path";
import { SiteHeader } from "@/components/site/site-header";
import { BuildStudio } from "@/components/build-studio/build-studio";
import { parseRecipes } from "@/components/build-studio/recipes";
import type { RecordedRun } from "@/components/build-studio/types";

export const metadata = {
  title: "Watch a build | A2UI Playground",
  description:
    "A recorded playground run, replayed: the layout is drawn first, then each A2UI component fills in as it arrives.",
};
export const dynamic = "force-dynamic";

/** Every recorded run in src/data (any JSON with frames + events), the landing run first. */
function loadRuns(): RecordedRun[] {
  const dir = path.join(process.cwd(), "src/data");
  const out: RecordedRun[] = [];
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) =>
      a === "replay.json" ? -1 : b === "replay.json" ? 1 : a.localeCompare(b),
    )) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (
        Array.isArray(d?.frames) &&
        d.frames.length &&
        Array.isArray(d?.events)
      )
        out.push({ ...d, file: f.replace(/\.json$/, "") });
    } catch {
      // not a recording
    }
  }
  return out;
}

export default function BuildPage() {
  const css = fs.readFileSync(
    path.join(process.cwd(), "src/components/build-studio/build-motion.css"),
    "utf8",
  );
  const { recipes } = parseRecipes(css);
  const runs = loadRuns();
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <SiteHeader active="build" />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 sm:px-6">
          <h1 className="text-[16px] font-semibold tracking-tight">
            Watch a build
          </h1>
          <p className="text-[13.5px] text-muted-foreground">
            A recorded playground run, replayed: the layout is drawn first, then
            each component fills in as it arrives.
          </p>
        </div>
        <BuildStudio runs={runs} recipes={recipes} />
      </main>
    </div>
  );
}
