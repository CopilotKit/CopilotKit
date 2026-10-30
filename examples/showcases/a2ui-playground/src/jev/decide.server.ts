/**
 * One run = (cafés only) a real place lookup, then ONE Jev call, then a deterministic A2UI surface.
 *
 *  - Places: `searchPlaces` from src/agent/apis.ts (OpenStreetMap Nominatim, Photon fallback), the same
 *    keyless lookup the playground's fixed `show_places` template uses. Timed on the server.
 *  - Jev: `client.systemOne` from `@typesafe-ai/sdk`, POST https://api.typesafe.ai/v1/systemone with
 *    TYPESAFE_API_KEY (server only). One layout choice plus one fit score per real candidate. Timed on the server.
 *
 * Fixture mode (`fixture: true`) replays a saved run from src/jev/fixtures (places and Jev's answers), with
 * its recorded waits. In dev, every successful live run overwrites the fixture for its city (or laptops).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { searchPlaces, type Poi } from "@/agent/apis";
import {
  cafesFor,
  JEV_MODEL,
  parseWhere,
  readAnswers,
  toOps,
  USE_CASES,
  type A2UIOp,
  type Answers,
  type CafePlace,
  type UseCase,
  type UseCaseId,
} from "./usecases";

type PlacesRecord = {
  city: string;
  source: string;
  ms: number;
  items: CafePlace[];
  cached?: boolean;
};
export type Fixture = {
  model: string;
  ms: number;
  recordedAt: string;
  mock: boolean;
  answers: Answers;
  places?: PlacesRecord;
  usage?: JevResult["usage"];
};

export type JevResult = {
  usecase: UseCaseId;
  prompt: string;
  model: string;
  source: "live" | "fixture" | "mock";
  /** Jev round trip measured on the server around the TypeSafe call, in ms. */
  jevMs: number;
  /** The real place lookup before the Jev call (cafés only). */
  places?: {
    city: string;
    source: string;
    ms: number;
    count: number;
    cached?: boolean;
  };
  questionCount: number;
  layout: string;
  layouts: Record<string, string>;
  layoutProbabilities: Record<string, number>;
  ranked: Array<{ id: string; name: string; score: number; fit: number }>;
  componentCount: number;
  surfaceId: string;
  ops: A2UIOp[];
  usage?: { inputTokens?: number };
};

/** One step of a run as it happened on the server. `t` is ms since the request reached the server. */
export type JevEvent = {
  t: number;
  kind: "request" | "places" | "jev" | "layout" | "ranked" | "ops" | "notice";
  label: string;
  detail?: string;
  layout?: string;
};

/** Nothing to decide on (unknown place, no cafés found). No Jev call is made. */
export type JevNotice = {
  usecase: UseCaseId;
  prompt: string;
  notice: string;
  places?: { city: string; ms: number };
};

let client: TypeSafeClient | null = null;
/** Created on first live use (the constructor throws without a key). No retries: one call per run. */
function getClient() {
  client ??= new TypeSafeClient({ retry: { maxRetries: 0 }, timeout: 10000 });
  return client;
}

const FIXTURES = path.join(process.cwd(), "src/jev/fixtures");
const fixtureFile = (key: string) => path.join(FIXTURES, `${key}.json`);

async function readFixture(key: string, what: string): Promise<Fixture> {
  try {
    return JSON.parse(await fs.readFile(fixtureFile(key), "utf8")) as Fixture;
  } catch {
    throw new Error(
      `No saved run for ${what} yet. Run it live once to record one.`,
    );
  }
}

/** Candidates Jev scores and the card shows: the same 8. */
export const CAFE_COUNT = 8;

const CHAINS =
  /\b(starbucks|dunkin|tim hortons|pret a manger|costa coffee|caribou|peet'?s|mcdonald)/i;
const NOT_A_CAFE =
  /\b(deli|grocery|market|bodega|boba|bubble tea|tea bar|tea house|tea shop|juice|ice cream|gelato|donut|bagels?|pizza|laundromat|catering)\b/i;
const NOT_COFFEE =
  /bubble_tea|juice|ice_cream|donut|bagel|pizza|burger|chocolate/;
/** Name and cuisine rules (also applied to saved runs when replaying). */
const looksLikeWorkCafe = (p: {
  name: string;
  tags?: Record<string, string>;
}) =>
  !NOT_A_CAFE.test(p.name) &&
  !NOT_COFFEE.test(p.tags?.cuisine ?? "") &&
  !CHAINS.test(p.name);
const norm = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/^city of /, "")
    .trim();

/**
 * Real cafés to work from: OSM amenity=cafe only, inside the requested city and state (no crossing a river into
 * another state or town), no bubble tea, delis or groceries, no big chains, nearest first. Nothing is added or edited.
 */
function workCafes(
  all: Poi[],
  center: { name: string; admin?: string },
): CafePlace[] {
  const city = norm(center.name);
  const state = norm(center.admin);
  return all
    .filter((p) => p.category === "cafe")
    .filter((p) => !state || !p.state || norm(p.state) === state)
    .filter(
      (p) =>
        !p.city || norm(p.city).includes(city) || city.includes(norm(p.city)),
    )
    .filter(looksLikeWorkCafe)
    .slice(0, CAFE_COUNT)
    .map(({ id, name, lat, lon, address, distanceKm, tags }) => ({
      id,
      name,
      lat,
      lon,
      address,
      distanceKm,
      tags,
    }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runJev({
  usecase,
  prompt,
  fixture,
  signal,
  onEvent,
  startedAt = performance.now(),
}: {
  usecase: UseCaseId;
  prompt: string;
  fixture: boolean;
  signal?: AbortSignal;
  /** Called as each step really completes (the streaming route forwards these). */
  onEvent?: (e: JevEvent) => void;
  /** Server clock origin for event timestamps (when the request arrived). */
  startedAt?: number;
}): Promise<JevResult | JevNotice> {
  if (!(usecase in USE_CASES)) throw new Error(`Unknown use case: ${usecase}`);
  const emit = (
    kind: JevEvent["kind"],
    label: string,
    detail?: string,
    extra?: Partial<JevEvent>,
  ) =>
    onEvent?.({
      t: Math.round(performance.now() - startedAt),
      kind,
      label,
      detail,
      ...extra,
    });
  const notice = (n: JevNotice) => (emit("notice", n.notice), n);

  // 1) Candidates.
  let uc: UseCase;
  let key: string;
  let places: PlacesRecord | undefined;
  let saved: Fixture | null = null;
  if (usecase === "cafes") {
    const where = parseWhere(prompt);
    key = `cafes-${where.slug}`;
    if (fixture) {
      try {
        saved = await readFixture(key, where.query);
      } catch {
        return notice({
          usecase,
          prompt,
          notice: `No saved run for ${where.query}. Remove ?fixture=1 to look it up live.`,
        });
      }
      if (!saved.places) throw new Error("Saved run has no places");
      await wait(saved.places.ms);
      // Older saved runs predate the café rules: apply the same name/cuisine rules on replay (Jev's answers are per café).
      places = {
        ...saved.places,
        items: saved.places.items
          .filter(looksLikeWorkCafe)
          .slice(0, CAFE_COUNT),
      };
    } else {
      const t0 = performance.now();
      try {
        const r = await searchPlaces("cafe", where.query, 36);
        const ms = Math.round(performance.now() - t0);
        // searchPlaces keeps a 15 minute in-memory cache; a lookup this fast was served from it.
        places = {
          city: r.center.name,
          source: r.source,
          ms,
          items: workCafes(r.places, r.center),
          cached: ms < 40,
        };
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        const msg = err instanceof Error ? err.message : String(err);
        return notice({
          usecase,
          prompt,
          notice: /could not find/i.test(msg)
            ? `Could not find a place called "${where.query}". Try a city name.`
            : `No cafés found near ${where.query} in OpenStreetMap.`,
          places: { city: where.query, ms },
        });
      }
    }
    emit(
      "places",
      `Found ${places.items.length} cafés`,
      `${places.city}${places.cached ? ", cached" : ""}`,
    );
    if (!places.items.length)
      return notice({
        usecase,
        prompt,
        notice: `No cafés found near ${places.city} in OpenStreetMap.`,
        places: { city: places.city, ms: places.ms },
      });
    uc = cafesFor(places.city, places.items);
  } else {
    uc = USE_CASES[usecase];
    key = usecase;
    if (fixture) saved = await readFixture(key, usecase);
  }
  const questions = uc.questions();

  // 2) The one Jev call.
  let answers: Answers;
  let jevMs: number;
  let model = JEV_MODEL;
  let source: JevResult["source"];
  let usage: JevResult["usage"];
  if (saved) {
    await wait(saved.ms);
    answers = saved.answers;
    jevMs = saved.ms;
    model = saved.model;
    source = saved.mock ? "mock" : "fixture";
    usage = saved.usage;
  } else {
    if (!process.env.TYPESAFE_API_KEY)
      throw new Error("TYPESAFE_API_KEY is not set");
    const t0 = performance.now();
    const r = await getClient().systemOne(
      {
        model: JEV_MODEL,
        state: uc.state(prompt) as never,
        questions: questions as never,
      },
      { signal },
    );
    jevMs = Math.round(performance.now() - t0);
    answers = r.answers as unknown as Answers;
    model = r.model ?? JEV_MODEL;
    source = "live";
    usage = { inputTokens: r.usage?.input_tokens ?? undefined };
    if (process.env.NODE_ENV !== "production") {
      const rec: Fixture = {
        model,
        ms: jevMs,
        recordedAt: new Date().toISOString(),
        mock: false,
        answers,
        places,
        usage,
      };
      await fs
        .writeFile(fixtureFile(key), JSON.stringify(rec, null, 2) + "\n")
        .catch((err) => console.warn("[jev] could not save fixture", err));
    }
  }

  const questionCount = saved
    ? Object.keys(saved.answers).length
    : Object.keys(questions).length;
  emit("jev", `Jev answered ${questionCount} questions`, `in ${jevMs} ms`);

  // 3) Deterministic A2UI from the answers.
  const read = readAnswers(uc, answers);
  const pick = read.layoutProbabilities[read.layout];
  emit(
    "layout",
    "Layout picked",
    pick != null ? `${Math.round(pick * 100)}%` : undefined,
    { layout: read.layout },
  );
  emit(
    "ranked",
    `Ranked ${read.ranked.length}`,
    read.ranked[0] ? `1. ${read.ranked[0].name}` : undefined,
  );
  const built = uc.build(read.layout, read.ranked);
  const surfaceId = `jev-${usecase}-${Math.random().toString(36).slice(2, 8)}`;
  const ops = toOps(surfaceId, built);
  emit("ops", `${ops.length} A2UI ops sent`);
  return {
    usecase,
    prompt,
    model,
    source,
    jevMs,
    places: places
      ? {
          city: places.city,
          source: places.source,
          ms: places.ms,
          count: places.items.length,
          cached: places.cached,
        }
      : undefined,
    // On replay, the number of questions the recorded call really asked.
    questionCount,
    layout: read.layout,
    layouts: uc.layouts,
    layoutProbabilities: read.layoutProbabilities,
    ranked: read.ranked,
    componentCount: built.components.length,
    surfaceId,
    ops,
    usage,
  };
}

export const isNotice = (r: JevResult | JevNotice): r is JevNotice =>
  "notice" in r;
