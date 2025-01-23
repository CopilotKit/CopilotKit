const fs = require("fs");
const path = require("path");
const json2md = require("json2md");
const childProcess = require("child_process");

const ENVIRONMENT = process.env.ENVIRONMENT;

if (!ENVIRONMENT) {
  throw new Error("ENVIRONMENT is not set");
}

console.log("ENVIRONMENT", ENVIRONMENT);
console.log("Getting release list")

const releaseList = JSON.parse(childProcess.execSync(
  `helmfile --state-values-set environment=${ENVIRONMENT} --selector "name!=examples-shared" list --output json`
).toString());

function getReleaseDeployments(releaseName) {
  const outputs = JSON.parse(childProcess.execSync(
    `kubectl get configmap -n ${ENVIRONMENT} ${releaseName}-outputs -o jsonpath='{.data}' | jq`
  ).toString());

  const deployments = JSON.parse(outputs.deployments);
  return deployments;
}

const tableRows = [];

for (const release of releaseList) {
  const releaseName = release.name;
  const deployments = getReleaseDeployments(releaseName);

  const row = {
    name: releaseName,
    previews: [],
  };

  const ui = deployments.find((deployment) => deployment.deployment === "ui");

  if (ui) {
    row.previews.push({
      label: "Preview (FastAPI)",
      url: `https://${ui.url}/`
    });
  } else {
    throw new Error(`UI deployment not found for ${releaseName}`);
  }

  const agentLgcPython = deployments.find((deployment) => deployment.deployment === "agent-lgc-python");

  if (agentLgcPython) {
    row.previews.push({
      label: "Preview (LangGraph Platform Python)",
      url: `https://${ui.url}?lgcDeploymentUrl=${agentLgcPython.url}`
    });
  }

  tableRows.push(row);
}

function generateTable() {
  const structure = [];
  structure.push({ h1: "Previews" });

  structure.push({
    p: `**Commit SHA:** ${process.env.GITHUB_SHA?.substring(0, 7)}`,
  });

  const rows = tableRows.map((release) => {
    return {
      Name: release.name,
      Previews: release.previews.map((preview) => `[${preview.label}](${preview.url})`).join(" • "),
    };
  });

  structure.push({
    table: {
      headers: ["Name", "Previews"],
      rows,
    },
  });

  const md = json2md(structure);
  console.log(md);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

generateTable();
