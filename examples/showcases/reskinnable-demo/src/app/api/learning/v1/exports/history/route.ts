import { json, preflight } from "@/skins/ledgerline/learning/http";
import { history } from "@/intelligence-ui/export/server";

export const dynamic = "force-dynamic";
/** Earlier exports, newest first (this session's plus two seeded ones). */
export const GET = () => json(history());
export const OPTIONS = preflight;
