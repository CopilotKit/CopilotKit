import fs from "node:fs";
import path from "node:path";
import { parseRecipes } from "@/components/build-studio/recipes";
import { BuildView } from "@/components/jev/build-view";

export const metadata = { title: "Jev chart | A2UI Playground" };

export default function JevChartPage() {
  const css = fs.readFileSync(
    path.join(process.cwd(), "src/components/build-studio/build-motion.css"),
    "utf8",
  );
  return <BuildView recipes={parseRecipes(css).recipes} usecase="spending" />;
}
