import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";

export const dynamic = "force-dynamic";
export const GET = () => json(store.state().evalCandidates);
export const OPTIONS = preflight;
