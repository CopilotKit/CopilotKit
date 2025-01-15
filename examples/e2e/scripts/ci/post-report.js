import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const getEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set`);
  }
  return value;
}

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const commentPrNumber = parseInt(getEnv("COMMENT_PR_NUMBER"));
const repo = getEnv("GITHUB_REPO");
const privateKey = getEnv("GITHUB_APP_PRIVATE_KEY");
const appId = getEnv("GITHUB_APP_ID");
const installationId = parseInt(getEnv("GITHUB_APP_INSTALLATION_ID"));

async function main() {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: Buffer.from(privateKey, "base64").toString("ascii"),
      installationId,
    }
  });

  let reportMd = fs.readFileSync(path.join(__dirname, "../../test-results/test-run-comment.md"), "utf8");

  reportMd = `### ⚠️ THESE TESTS RAN AGAINST A COPILOT CLOUD PREVIEW ENVIRONMENT\n\n` + reportMd;

  const comment = await octokit.rest.issues.createComment({
    issue_number: commentPrNumber,
    owner: "copilotkit",
    repo,
    body: reportMd,
  });
}

main();
