/// <reference path="../pb_data/types.d.ts" />
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
