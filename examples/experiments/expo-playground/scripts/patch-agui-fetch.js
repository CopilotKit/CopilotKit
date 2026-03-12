#!/usr/bin/env node
const fs = require('fs');

function patchFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, fileContent.replace('(fetch(', `(require("expo/fetch").fetch(`));
}

function main() {
  const aguiClientPath = require.resolve('@ag-ui/client');
  patchFile(aguiClientPath);
}

main();
