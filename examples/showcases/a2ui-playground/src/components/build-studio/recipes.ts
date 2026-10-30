import type { Recipe } from "./types";

const SKIP = new Set(["tokens", "reduced motion"]);

/** Splits build-motion.css on its `/* recipe / name *\/` markers. Runs on the server. */
export function parseRecipes(css: string): { recipes: Recipe[]; tokenCount: number } {
  const re = /\/\* recipe \/ ([^*]+?) \*\//g;
  const marks = Array.from(css.matchAll(re));
  const recipes: Recipe[] = [];
  let tokenCount = 0;
  marks.forEach((m, i) => {
    const name = m[1].trim();
    const key = name.replace(/\s*\(.*\)\s*$/, "").trim();
    const end = i + 1 < marks.length ? marks[i + 1].index! : css.length;
    const body = css.slice(m.index! + m[0].length, end).replace(/^\s*\n/, "").trimEnd();
    if (key === "tokens") tokenCount = (body.match(/^\s*--[\w-]+\s*:/gm) ?? []).length;
    if (SKIP.has(key)) return;
    recipes.push({ key, name, text: `/* recipe / ${name} */\n${body}` });
  });
  return { recipes, tokenCount };
}

const CHART = /Chart$|^Sparkline$|^Heatmap$|^Treemap$|^Gauge$/;
const NUMBER = /^(Stat|StatGroup|Progress|RadialProgress|StockTicker)$/;
const TEXT = /^(Heading|Text|Markdown|Quote|Callout)$/;
const MAP = /^(MapView|RouteMap|LocationCard|PlaceList)$/;
const PANEL = /^(Card|Section)$/;

/** The recipe a fill of `type` plays. */
export function fillRecipe(type: string): string {
  if (NUMBER.test(type)) return "number pop-in";
  if (TEXT.test(type)) return "streaming text";
  if (CHART.test(type)) return "chart grow";
  if (MAP.test(type)) return "pin drop";
  if (PANEL.test(type)) return "panel reveal";
  return "skeleton reveal";
}
