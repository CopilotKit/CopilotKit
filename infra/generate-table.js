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

  const json = JSON.parse(file);

  console.log(json);

  structure.push({
    table: {
      headers: ["Name", "URL"],
      rows: Object.entries(json)
        .filter(([key, value]) => value.IncludeInComment === "true")
        .map(([key, value]) => ({
          Name: value.ProjectName,
          URL: `[Link](${value.FunctionUrl})`,
        })),
    },
  });

  const md = json2md(structure);
  console.log(md);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

function generateProcessedOutputForTests() {
  let output = "";
  const json = JSON.parse(file);

  Object.entries(json)
    .filter(([key, value]) => !!value.OutputEnvVariable)
    .forEach(([key, value]) => {
      const envVariableName = value.OutputEnvVariable;
      output += `${envVariableName}="${value.FunctionUrl.replace(/\/$/, '')}"\n`;
    });

  fs.writeFileSync(path.resolve(__dirname, "./.env.test"), output);
}

generateTable();
generateProcessedOutputForTests();
