import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import crypto from "node:crypto";

const app = new Hono();

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const APP_ID = process.env.GITHUB_APP_ID ?? "1108748";
const PRIVATE_KEY = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(
  /\\n/g,
  "\n",
);
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID ?? "";

function verifySignature(payload: string, signature: string): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

function getOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      installationId: Number(INSTALLATION_ID),
    },
  });
}

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/github", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";

  if (!verifySignature(body, signature)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = c.req.header("x-github-event");
  if (event !== "check_run") {
    return c.json({ ignored: true }, 200);
  }

  const payload = JSON.parse(body);
  if (
    payload.action !== "requested_action" ||
    payload.requested_action?.identifier !== "run-eval"
  ) {
    return c.json({ ignored: true }, 200);
  }

  const checkRun = payload.check_run;
  const prNumber =
    checkRun.external_id || checkRun.pull_requests?.[0]?.number?.toString();

  if (!prNumber) {
    return c.json({ error: "no PR number found" }, 422);
  }

  const octokit = getOctokit();

  await octokit.checks.update({
    owner: "CopilotKit",
    repo: "CopilotKit",
    check_run_id: checkRun.id,
    status: "in_progress",
  });

  await octokit.actions.createWorkflowDispatch({
    owner: "CopilotKit",
    repo: "CopilotKit",
    workflow_id: "showcase_eval.yml",
    ref: "main",
    inputs: {
      pr_number: prNumber,
      check_run_id: String(checkRun.id),
    },
  });

  console.log(
    `Dispatched eval for PR #${prNumber}, check_run_id=${checkRun.id}`,
  );
  return c.json({ dispatched: true, pr: prNumber }, 200);
});

// ---------------------------------------------------------------------------
// Signed trigger link — clicked from the bot comment on the PR
// ---------------------------------------------------------------------------

const TRIGGER_SECRET = WEBHOOK_SECRET; // reuse the same secret for HMAC signing

export function signTriggerUrl(pr: string, checkRunId: string): string {
  const payload = `${pr}:${checkRunId}`;
  const sig = crypto
    .createHmac("sha256", TRIGGER_SECRET)
    .update(payload)
    .digest("hex");
  return sig;
}

function verifyTriggerSig(
  pr: string,
  checkRunId: string,
  sig: string,
): boolean {
  const expected = signTriggerUrl(pr, checkRunId);
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

function validateTriggerParams(
  pr: string,
  checkRunId: string,
  sig: string,
): { valid: true } | { valid: false; status: 400 | 403; message: string } {
  if (!pr || !sig) {
    return { valid: false, status: 400, message: "Missing parameters." };
  }
  if (!verifyTriggerSig(pr, checkRunId, sig)) {
    return { valid: false, status: 403, message: "Invalid signature." };
  }
  return { valid: true };
}

app.get("/trigger/eval", async (c) => {
  const pr = c.req.query("pr") ?? "";
  const checkRunId = c.req.query("check_run_id") ?? "";
  const sig = c.req.query("sig") ?? "";

  const result = validateTriggerParams(pr, checkRunId, sig);
  if (result.valid !== true) {
    return c.html(
      `<h2>${result.status === 400 ? "Invalid request" : "Unauthorized"}</h2><p>${result.message}</p>`,
      result.status,
    );
  }

  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Showcase Eval — PR #${pr}</title>
      <style>
        body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0d1117; color: #e6edf3; }
        div { text-align: center; }
        h2 { color: #3fb950; }
        button { background: #238636; color: #fff; border: 1px solid #2ea043; border-radius: 6px; padding: 10px 24px; font-size: 16px; cursor: pointer; font-family: system-ui; }
        button:hover { background: #2ea043; }
      </style>
    </head>
    <body>
      <div>
        <h2>Showcase Eval</h2>
        <p>PR #${pr}</p>
        <form method="POST" action="/trigger/eval" target="_blank">
          <input type="hidden" name="pr" value="${pr}" />
          <input type="hidden" name="check_run_id" value="${checkRunId}" />
          <input type="hidden" name="sig" value="${sig}" />
          <button type="submit">Run Evaluation</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post("/trigger/eval", async (c) => {
  const body = await c.req.parseBody();
  const pr = String(body["pr"] ?? "");
  const checkRunId = String(body["check_run_id"] ?? "");
  const sig = String(body["sig"] ?? "");

  const result = validateTriggerParams(pr, checkRunId, sig);
  if (result.valid !== true) {
    return c.html(
      `<h2>${result.status === 400 ? "Invalid request" : "Unauthorized"}</h2><p>${result.message}</p>`,
      result.status,
    );
  }

  const octokit = getOctokit();

  if (checkRunId) {
    await octokit.checks.update({
      owner: "CopilotKit",
      repo: "CopilotKit",
      check_run_id: Number(checkRunId),
      status: "in_progress",
      output: {
        title: "Showcase Eval — running...",
        summary: "Evaluation in progress.",
      },
    });
  }

  await octokit.actions.createWorkflowDispatch({
    owner: "CopilotKit",
    repo: "CopilotKit",
    workflow_id: "showcase_eval.yml",
    ref: "main",
    inputs: {
      pr_number: pr,
      check_run_id: checkRunId || "",
    },
  });

  console.log(
    `Trigger link: dispatched eval for PR #${pr}, check_run_id=${checkRunId}`,
  );

  // Poll for the Actions run URL (up to ~5 seconds)
  const fallbackUrl =
    "https://github.com/CopilotKit/CopilotKit/actions/workflows/showcase_eval.yml";
  let runUrl = fallbackUrl;
  const startTime = Date.now();

  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const runs = await octokit.actions.listWorkflowRuns({
        owner: "CopilotKit",
        repo: "CopilotKit",
        workflow_id: "showcase_eval.yml",
        event: "workflow_dispatch",
        per_page: 5,
      });
      const recent = runs.data.workflow_runs.find((run) => {
        const created = new Date(run.created_at).getTime();
        return Date.now() - created < 30_000;
      });
      if (recent) {
        runUrl = recent.html_url;
        break;
      }
    } catch {
      // ignore polling errors
    }
    if (Date.now() - startTime > 5000) break;
  }

  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Showcase Eval — dispatched</title>
      <meta http-equiv="refresh" content="0;url=${runUrl}">
      <style>
        body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0d1117; color: #e6edf3; }
        div { text-align: center; }
        h2 { color: #3fb950; }
        a { color: #58a6ff; }
      </style>
    </head>
    <body>
      <div>
        <h2>Showcase Eval triggered</h2>
        <p>PR #${pr} — evaluation dispatched.</p>
        <p>Redirecting to <a href="${runUrl}">the Actions run</a>...</p>
      </div>
    </body>
    </html>
  `);
});

const port = Number(process.env.PORT ?? 3000);
console.log(`eval-webhook listening on :${port}`);
serve({ fetch: app.fetch, port });
