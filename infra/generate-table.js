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

  console.log(json)

  for (const key in json) {
    structure.push({ h2: key });
    const vars = json[key];
    structure.push({
      table: {
        headers: ["desc", "url"],
        rows: [{ desc: "Preview URL", url: `[Link](${vars["UiUrl"]})` }]
      }
    });
  }

  const md = json2md(structure);
  fs.writeFileSync(path.resolve(__dirname, "./preview-comment.md"), md);
}

generateTable();
