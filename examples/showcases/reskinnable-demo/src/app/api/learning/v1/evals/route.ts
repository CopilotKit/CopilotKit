import { json, preflight } from "@/skins/ledgerline/learning/http";
import { evalSuite } from "@/skins/ledgerline/learning/evals";

export const dynamic = "force-dynamic";
export const GET = () => json(evalSuite());
export const OPTIONS = preflight;
