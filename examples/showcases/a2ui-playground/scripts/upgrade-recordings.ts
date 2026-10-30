/**
 * Converts recordings made with A2UI v0.9 (src/data/*.json) to A2UI v1.0 on
 * the Gen UI 2.0 standard components, in place.
 *
 * A v0.9 frame was a full snapshot (createSurface + the whole component list).
 * A v1.0 frame is what the chat really receives now: the surface's operation
 * list so far, where each later frame appends an `updateComponents` with only
 * the components that changed (and an `updateDataModel` when the data did).
 *
 *   pnpm dlx tsx --tsconfig tsconfig.json scripts/upgrade-recordings.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  A2UI_VERSION,
  type A2UIComponentNode,
  type A2UIOperation,
} from "@copilotkit/shared";
import { upgradeComponents } from "@/a2ui/upgrade-v09";

type Frame = { t: number; key?: string; ops: Array<Record<string, unknown>> };

const dir = path.join(process.cwd(), "src/data");

function snapshot(ops: Frame["ops"]) {
  let surfaceId = "surface";
  let catalogId: string | undefined;
  let components: A2UIComponentNode[] = [];
  let data: unknown;
  for (const op of ops) {
    const create = op.createSurface as
      | { surfaceId: string; catalogId?: string }
      | undefined;
    if (create) ({ surfaceId, catalogId } = create);
    const update = op.updateComponents as
      | { surfaceId: string; components: A2UIComponentNode[] }
      | undefined;
    if (update) components = upgradeComponents(update.components);
    const model = op.updateDataModel as { value?: unknown } | undefined;
    if (model) data = model.value;
  }
  return { surfaceId, catalogId, components, data };
}

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const full = path.join(dir, file);
  const rec = JSON.parse(fs.readFileSync(full, "utf8")) as { frames?: Frame[] };
  if (!Array.isArray(rec.frames) || !rec.frames.length) continue;
  if (
    rec.frames.every((f) => f.ops.every((op) => op.version === A2UI_VERSION))
  ) {
    console.log(`${file}: already v1.0`);
    continue;
  }
  const opsByKey = new Map<string, A2UIOperation[]>();
  const seen = new Map<string, Map<string, string>>();
  const lastData = new Map<string, string>();
  const frames = rec.frames.map((f) => {
    const key = f.key ?? "surface";
    const s = snapshot(f.ops);
    let ops = opsByKey.get(key);
    let sent = seen.get(key);
    if (!ops || !sent) {
      ops = [
        {
          version: A2UI_VERSION,
          createSurface: {
            surfaceId: s.surfaceId,
            ...(s.catalogId ? { catalogId: s.catalogId } : {}),
          },
        },
      ];
      sent = new Map();
      opsByKey.set(key, ops);
      seen.set(key, sent);
    }
    const data = s.data === undefined ? undefined : JSON.stringify(s.data);
    if (data !== undefined && data !== lastData.get(key)) {
      ops.push({
        version: A2UI_VERSION,
        updateDataModel: { surfaceId: s.surfaceId, path: "/", value: s.data },
      });
      lastData.set(key, data);
    }
    const changed = s.components.filter(
      (c) => sent.get(c.id) !== JSON.stringify(c),
    );
    for (const c of changed) sent.set(c.id, JSON.stringify(c));
    if (changed.length)
      ops.push({
        version: A2UI_VERSION,
        updateComponents: { surfaceId: s.surfaceId, components: changed },
      });
    return { ...f, ops: [...ops] };
  });
  fs.writeFileSync(full, JSON.stringify({ ...rec, frames }));
  console.log(
    `${file}: ${frames.length} frames, ${(fs.statSync(full).size / 1024).toFixed(0)} KB`,
  );
}
