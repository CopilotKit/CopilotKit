const fs = require("fs");
const path = require("path");
const json2md = require("json2md");

const file = fs.readFileSync(
  path.resolve(__dirname, "./cdk_outputs.json"),
  "utf8"
);

function generateTable() {
  const structure = [];
  structure.push({ h1: "Previews" });

  structure.push({
    p: `**Commit SHA:** ${process.env.GITHUB_SHA?.substring(0, 7)}`,
  });

  const json = JSON.parse(file);

  // Group entries by ProjectName
  const projectGroups = Object.values(json).reduce((acc, entry) => {
    if (!acc[entry.ProjectName]) {
      acc[entry.ProjectName] = {
        name: entry.ProjectName,
        remote: "",
        local: "",
        lgcPythonDeploymentUrl: undefined,
        lgcJSDeploymentUrl: undefined,
      };
    }

    // Add URLs based on dependency type
    if (entry.Dependencies === "Remote") {
      acc[entry.ProjectName].remote = entry.FunctionUrl;
    } else if (entry.Dependencies === "Local") {
      acc[entry.ProjectName].local = entry.FunctionUrl;
    }

    // Add LGC Python Deployment URL if it exists
    if (entry.LgcPythonDeploymentUrl) {
      acc[entry.ProjectName].lgcPythonDeploymentUrl = entry.LgcPythonDeploymentUrl;
    }

    // Add LGC JS Deployment URL if it exists
    if (entry.LgcJSDeploymentUrl) {
      acc[entry.ProjectName].lgcJSDeploymentUrl = entry.LgcJSDeploymentUrl;
    }

    return acc;
  }, {});

  // Convert grouped data to rows array
  const rows = Object.values(projectGroups).map((project) => {
    let previewMdxString = `[Preview](${project.local})`;

    if (project.lgcPythonDeploymentUrl) {
      previewMdxString += ` • [Preview with LGC Python](${project.local}?lgcDeploymentUrl=${project.lgcPythonDeploymentUrl})`;
    }

    if (project.lgcJSDeploymentUrl) {
      previewMdxString += ` • [Preview with LGC JS](${project.local}?lgcDeploymentUrl=${project.lgcJSDeploymentUrl})`;
    }

    const row = {
      Name: project.name,
      "Preview": previewMdxString,
    };

    return row;
  });

  structure.push({
    table: {
      // headers: ["Name", "Preview (Local Dependencies)", "Preview (Remote Dependencies)"],
      headers: ["Name", "Preview"],
      rows,
    },
  });

  const md = json2md(structure);
  console.log(md);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

generateTable();
