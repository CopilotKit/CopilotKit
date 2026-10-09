import fs from "fs";

/**
 * Build-time helper for local Dojo runs.
 *
 * When SHOWCASE_LOCAL=1, Next bakes a slug -> localhost URL map from
 * shared/local-ports.json into NEXT_PUBLIC_LOCAL_BACKENDS. Deployed builds leave
 * this empty and keep using registry backend_url values.
 */
export function localBackendsEnv(portsPath: string): string {
  const rawLocal = process.env.SHOWCASE_LOCAL;
  const showcaseLocal = rawLocal === undefined ? "" : rawLocal.trim();
  if (showcaseLocal !== "1") {
    if (showcaseLocal !== "") {
      console.warn(
        `[next.config] SHOWCASE_LOCAL is set to ${JSON.stringify(rawLocal)} ` +
          `but only "1" enables local backend overrides — treating it as off.`,
      );
    }
    return "";
  }

  let rawText: string;
  try {
    rawText = fs.readFileSync(portsPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.warn(
        `[next.config] SHOWCASE_LOCAL=1 but ${portsPath} does not exist — ` +
          `no local backend overrides will be baked.`,
      );
      return "";
    }
    throw new Error(`${portsPath} could not be read: ${String(err)}`, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`${portsPath} is not valid JSON: ${String(err)}`, {
      cause: err,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${portsPath} must be a JSON object mapping slug -> port.`);
  }

  const map: Record<string, string> = Object.create(null);
  for (const [slug, port] of Object.entries(parsed)) {
    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port <= 0 ||
      port > 65535
    ) {
      throw new Error(
        `${portsPath}: port for "${slug}" is not a valid TCP port; got ` +
          `${JSON.stringify(port)}.`,
      );
    }
    map[slug] = `http://localhost:${port}`;
  }

  return JSON.stringify(map);
}
