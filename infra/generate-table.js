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
    p: `**Commit SHA:** ${process.env.GITHUB_SHA?.substring(0, 7)}`
  });

  const json = JSON.parse(file);

  // Group entries by ProjectName
  const projectGroups = Object.values(json).reduce((acc, entry) => {
    if (!acc[entry.ProjectName]) {
      acc[entry.ProjectName] = {
        name: entry.ProjectName,
        remote: '',
        local: ''
      };
    }
    
    // Add URLs based on dependency type
    if (entry.Dependencies === 'Remote') {
      acc[entry.ProjectName].remote = `[Preview](${entry.FunctionUrl})`;
    } else if (entry.Dependencies === 'Local') {
      acc[entry.ProjectName].local = `[Preview](${entry.FunctionUrl})`;
    }
    
    return acc;
  }, {});

  // Convert grouped data to rows array
  const rows = Object.values(projectGroups).map(project => ({
    "Name": project.name,
    "Preview (Local Dependencies)": project.local,
    "Preview (Remote Dependencies)": project.remote
  }));

  structure.push({
    table: {
      headers: ["Name", "Preview (Local Dependencies)", "Preview (Remote Dependencies)"],
      rows,
    },
  });

  const md = json2md(structure);
  console.log(md);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

generateTable();
