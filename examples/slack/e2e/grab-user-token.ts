/**
 * One-off: grab the User OAuth Token (xoxp-) for the bot's Slack app by:
 *  1) updating the manifest to declare `chat:write` user scope
 *  2) saving the manifest
 *  3) reinstalling the app (which approves the new user scope)
 *  4) reading the User OAuth Token from the OAuth & Permissions page
 *  5) writing SLACK_USER_TOKEN into .env
 *
 * Uses the persistent playwright profile under ./e2e/.chrome-profile/.
 */
import "dotenv/config";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const PROFILE_DIR = "./e2e/.chrome-profile";
const APP_ID = "A0B49763Y66";
const TEAM_ID = "T05QFA4BW9X";

const MANIFEST_PATH = "./slack-app-manifest.json";
const ENV_PATH = "./.env";

async function setCodeMirrorValue(page: Page, value: string): Promise<void> {
  // CodeMirror v5: set the value via the instance, dispatch a synthetic
  // "change" so React (the Slack dashboard) notices the dirty state and
  // enables Save Changes.
  await page.evaluate((val) => {
    const cm = (
      document.querySelector(".CodeMirror") as unknown as {
        CodeMirror?: {
          setValue(s: string): void;
          getValue(): string;
        };
      }
    )?.CodeMirror;
    if (!cm) throw new Error("CodeMirror instance not found");
    cm.setValue(val);
  }, value);
}

async function waitForVisibleEnabledButton(
  page: Page,
  label: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((lab) => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) =>
          b.textContent?.trim() === lab &&
          !b.disabled &&
          (b as HTMLElement).offsetParent !== null,
      );
      return !!btn;
    }, label);
    if (found) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`Timed out waiting for enabled button: "${label}"`);
}

async function clickButtonByText(page: Page, label: string): Promise<void> {
  await page.evaluate((lab) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === lab && !b.disabled,
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`No enabled button "${lab}"`);
    btn.click();
  }, label);
}

async function main() {
  const manifestJson = readFileSync(MANIFEST_PATH, "utf8");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  // ── 1+2. Save manifest ────────────────────────────────────────────
  console.log("[grab-token] → manifest editor");
  await page.goto(
    `https://app.slack.com/app-settings/${TEAM_ID}/${APP_ID}/app-manifest`,
    { waitUntil: "networkidle" },
  );
  await page.waitForSelector(".CodeMirror", { timeout: 15000 });
  await page.waitForTimeout(1000);

  await setCodeMirrorValue(page, manifestJson);
  await page.waitForTimeout(800);

  console.log("[grab-token] waiting for Save Changes to enable");
  try {
    await waitForVisibleEnabledButton(page, "Save Changes", 10_000);
  } catch {
    // Already saved? Pull the current editor contents and compare.
    const currentVal = await page.evaluate(() => {
      const cm = (
        document.querySelector(".CodeMirror") as unknown as {
          CodeMirror?: { getValue(): string };
        }
      )?.CodeMirror;
      return cm?.getValue() ?? "";
    });
    if (currentVal.includes('"user"') && currentVal.includes('"chat:write"')) {
      console.log(
        "[grab-token] manifest already has user scope, no save needed",
      );
    } else {
      throw new Error(
        "Save Changes button did not enable and current manifest doesn't have user scope",
      );
    }
  }

  // Try save (may already be saved)
  const saveEnabled = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save Changes",
    ) as HTMLButtonElement | undefined;
    return !!(btn && !btn.disabled);
  });
  if (saveEnabled) {
    console.log("[grab-token] clicking Save Changes");
    await clickButtonByText(page, "Save Changes");
    // Some manifest changes trigger a confirmation modal (esp. scope changes).
    await page.waitForTimeout(2000);
    // Click any confirmation buttons that pop up.
    const confirmed = await page.evaluate(() => {
      const labels = ["Save", "Yes, save changes", "Continue", "Save Changes"];
      for (const lab of labels) {
        const btn = Array.from(document.querySelectorAll("button")).find(
          (b) =>
            b.textContent?.trim() === lab &&
            !b.disabled &&
            (b as HTMLElement).offsetParent !== null,
        ) as HTMLButtonElement | undefined;
        if (btn) {
          btn.click();
          return lab;
        }
      }
      return null;
    });
    if (confirmed) console.log(`[grab-token] confirmation: "${confirmed}"`);
    await page.waitForTimeout(3000);
  }

  // ── 3. Reinstall (will OAuth-approve the new user scope) ──────────
  console.log("[grab-token] → install page");
  await page.goto(`https://api.slack.com/apps/${APP_ID}/install-on-team`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);

  const installLink = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find(
      (el) =>
        /^(re)?install to/i.test((el.textContent ?? "").trim()) &&
        el.href.includes("/oauth/v2/authorize"),
    );
    return a?.href ?? null;
  });
  if (!installLink) throw new Error("Couldn't find Install/Reinstall link");
  console.log("[grab-token] → install link →", installLink.slice(0, 80) + "…");
  await page.goto(installLink, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // ── 4. Approve OAuth — Allow button on the consent page ───────────
  console.log("[grab-token] looking for Allow button");
  try {
    await page.waitForFunction(
      () =>
        !!Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.trim() === "Allow",
        ),
      { timeout: 8000 },
    );
    // Real click via DOM event submission (the Allow button is a real <button type=submit>).
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Allow" && !b.disabled,
      ) as HTMLButtonElement | undefined;
      if (!btn) throw new Error("Allow button not found / disabled");
      // Submit the form (Slack's Allow is type=submit inside a form).
      if (btn.form) btn.form.submit();
      else btn.click();
    });
    console.log("[grab-token] Allow submitted; waiting for redirect");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log(
      "[grab-token] no Allow button (maybe already approved?):",
      (err as Error).message,
    );
  }

  // ── 5. Read both tokens from OAuth & Permissions ──────────────────
  console.log("[grab-token] → OAuth & Permissions");
  await page.goto(`https://api.slack.com/apps/${APP_ID}/oauth`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2500);

  const tokens = await page.evaluate(() => {
    const fields = Array.from(
      document.querySelectorAll("input[readonly]"),
    ) as HTMLInputElement[];
    const found: { kind: string; value: string }[] = [];
    for (const f of fields) {
      const v = f.value ?? "";
      if (v.startsWith("xoxb-")) found.push({ kind: "bot", value: v });
      else if (v.startsWith("xoxp-")) found.push({ kind: "user", value: v });
    }
    return found;
  });
  console.log(
    "[grab-token] found tokens:",
    tokens.map((t) => t.kind),
  );

  const bot = tokens.find((t) => t.kind === "bot")?.value;
  const user = tokens.find((t) => t.kind === "user")?.value;
  if (!user) {
    // Dump some page state to help debug.
    const debugInfo = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      readonlyValues: Array.from(document.querySelectorAll("input[readonly]"))
        .map((i) => (i as HTMLInputElement).value)
        .slice(0, 8),
      buttons: Array.from(document.querySelectorAll("button"))
        .map((b) => b.textContent?.trim())
        .filter((t) => t && t.length < 40),
    }));
    console.log("[grab-token] debug:", JSON.stringify(debugInfo, null, 2));
    throw new Error("Did not find xoxp- user token");
  }

  // ── 6. Write to .env (preserve existing keys) ─────────────────────
  const envText = readFileSync(ENV_PATH, "utf8");
  let updated = upsertEnv(envText, "SLACK_USER_TOKEN", user);
  if (bot) updated = upsertEnv(updated, "SLACK_BOT_TOKEN", bot);
  writeFileSync(ENV_PATH, updated);
  console.log("[grab-token] wrote tokens to .env");

  await context.close();
}

function upsertEnv(text: string, key: string, value: string): string {
  if (!value) return text;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return text + (text.endsWith("\n") ? "" : "\n") + `${key}=${value}\n`;
}

main().catch((err) => {
  console.error("[grab-token] failed:", err);
  process.exit(1);
});
