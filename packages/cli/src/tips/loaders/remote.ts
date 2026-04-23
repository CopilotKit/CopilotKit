import fs from "fs";
import path from "path";
import os from "os";
import type { Tip } from "../types.js";
import { postCreateTips } from "../content/post-create.js";
import { devTips } from "../content/dev.js";

export interface Alert {
  message: string;
  level: "info" | "warning" | "error";
}

export interface RemoteTipsConfig {
  version: number;
  alert?: Alert | null;
  tips: Record<string, Tip[]>;
}

export interface RemoteTipResult {
  tips: Tip[];
  alert?: Alert | null;
}

const REMOTE_URL = "https://docs.copilotkit.ai/cli/tips.json";
const CACHE_PATH = path.join(os.homedir(), ".copilotkit", "remote-tips.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000; // Don't block the CLI for more than 3s

const FALLBACK_TIPS: Record<string, Tip[]> = {
  "post-create": postCreateTips,
  dev: devTips,
};

interface CacheEnvelope {
  fetchedAt: string;
  data: RemoteTipsConfig;
}

function readCache(): CacheEnvelope | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const envelope: CacheEnvelope = JSON.parse(raw);
    if (!envelope.fetchedAt || !envelope.data) return null;
    return envelope;
  } catch {
    return null;
  }
}

function writeCache(data: RemoteTipsConfig): void {
  try {
    const dir = path.dirname(CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const envelope: CacheEnvelope = {
      fetchedAt: new Date().toISOString(),
      data,
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(envelope, null, 2), "utf-8");
  } catch {
    // Non-critical
  }
}

function isCacheFresh(envelope: CacheEnvelope): boolean {
  const age = Date.now() - new Date(envelope.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

function validateTips(arr: unknown): Tip[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (t): t is Tip =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as Tip).id === "string" &&
      typeof (t as Tip).message === "string",
  );
}

function validateAlert(alert: unknown): Alert | null {
  if (!alert || typeof alert !== "object") return null;
  const a = alert as Record<string, unknown>;
  if (typeof a.message !== "string" || !a.message) return null;
  if (!["info", "warning", "error"].includes(a.level as string)) return null;
  return { message: a.message, level: a.level as Alert["level"] };
}

function extractResult(
  data: RemoteTipsConfig,
  command: string,
): RemoteTipResult {
  const tips = validateTips(data.tips?.[command]);
  const alert = validateAlert(data.alert);
  return {
    tips: tips.length > 0 ? tips : (FALLBACK_TIPS[command] ?? []),
    alert,
  };
}

async function fetchRemoteConfig(): Promise<RemoteTipsConfig | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data !== "object" || !data || typeof data.version !== "number") {
      return null;
    }
    return data as RemoteTipsConfig;
  } catch {
    return null;
  }
}

/**
 * Load tips for a given command from the remote config, with local cache and
 * hardcoded fallback. Never throws — always returns usable tips.
 */
export async function loadRemoteTips(
  command: string,
): Promise<RemoteTipResult> {
  // 1. Check cache
  const cached = readCache();
  if (cached && isCacheFresh(cached)) {
    return extractResult(cached.data, command);
  }

  // 2. Fetch remote (non-blocking timeout)
  const remote = await fetchRemoteConfig();
  if (remote) {
    writeCache(remote);
    return extractResult(remote, command);
  }

  // 3. Stale cache is better than nothing
  if (cached) {
    return extractResult(cached.data, command);
  }

  // 4. Hardcoded fallback
  return { tips: FALLBACK_TIPS[command] ?? [] };
}
