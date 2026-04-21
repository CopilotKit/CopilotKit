/// <reference path="../pb_data/types.d.ts" />
// CORS default: the production dashboard origin
// (https://dashboard.showcase.copilotkit.ai) is baked in as the migration
// default so a fresh volume is immediately reachable from prod without
// requiring operator env-var configuration. PB_CORS_ORIGINS augments
// that list additively — it is NOT an override. If prod ever moves off
// the dashboard.showcase.copilotkit.ai origin, this migration's default
// needs to change (env var alone won't retire the stale origin, because
// older settings.json values persist across redeploys once saved).
// See rotation-drill.md for the migration path.
migrate(
  (db) => {
    const dao = new Dao(db);
    const settings = dao.findSettings();
    const extraOrigins = ($os.getenv("PB_CORS_ORIGINS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    settings.meta.cors = {
      enabled: true,
      origins: ["https://dashboard.showcase.copilotkit.ai", ...extraOrigins],
    };
    dao.saveSettings(settings);
  },
  (db) => {
    const dao = new Dao(db);
    const settings = dao.findSettings();
    settings.meta.cors = { enabled: false, origins: [] };
    dao.saveSettings(settings);
  },
);
