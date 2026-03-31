const fs = require("fs");
const { join } = require("path");

const packageDirs = [
  "react-core",
  "react-ui",
  "sdk-js",
  "react-textarea",
  "runtime",
  "runtime-client-gql",
  "shared",
];

function getPackageChangelog(packageDir, version) {
  const packageJsonPath = join(__dirname, `../../packages/${packageDir}/package.json`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const packageName = packageJson.name;

  const changelogPath = join(__dirname, `../../packages/${packageDir}/CHANGELOG.md`);
  const changelog = fs.readFileSync(changelogPath, "utf8");

  // Find where the following line starts: "## ${version}"
  const changelogStart = changelog.indexOf(`## ${version}`);

  if (changelogStart === -1) {
    throw new Error(`Changelog for ${packageName} version ${version} not found`);
  }

  // Find the next "## " after our version section
  const changelogEnd = changelog.indexOf("\n## ", changelogStart + 1);
  
  // If no next section found, use the entire rest of the file
  const sectionEnd = changelogEnd === -1 ? changelog.length : changelogEnd;

  // Return just the section for this version
  const changelogSection = changelog.slice(changelogStart, sectionEnd);

  const packageChangelog = `# ${packageName}\n\n${changelogSection}`;

  return packageChangelog;
}

function getFullReleaseChangelog(version) {
  let changelogs = [];
  for (const packageDir of packageDirs) {
    changelogs.push(getPackageChangelog(packageDir, version));
  }

  const changelog = changelogs.join("\n\n");
  console.log(changelog);
  return changelog;
}

module.exports = getFullReleaseChangelog;