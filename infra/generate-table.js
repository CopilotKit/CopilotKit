const fs = require("fs");
const path = require("path");
const json2md = require("json2md");

function generateTable() {
  const structure = [];
  structure.push({ h1: "Previews" });

  const file = fs.readFileSync(
    path.resolve(__dirname, "./cdk_outputs.json"),
    "utf8"
  );
  const json = JSON.parse(file);

  console.log(json);

  structure.push({
    table: {
      headers: ["Name", "URL"],
      rows: Object.entries(json).map(([key, value]) => ({
        Name: value.ProjectName,
        URL: `[Link](${value.UiUrl})`,
      })),
    },
  });

  const md = json2md(structure);
  console.log(md);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

generateTable();
