const childProcess = require("child_process");
const fs = require("fs");

async function main() {
  const releaseList = JSON.parse(
    childProcess.execSync(`helm list --all-namespaces -o json`).toString()
  );

  const previewReleases = releaseList
    .filter((release) => release.namespace.startsWith("prv"))
    .filter((release) => release.name === "next-openai")
    .filter((release) => release.namespace !== "prv-main");

  const inactiveReleases = previewReleases.filter(
    (release) => {
      const now = new Date();
      const releaseUpdatedAt = new Date(release.updated);
      const compareDate = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago
      return releaseUpdatedAt < compareDate;
    }
  );

  const numReleasesToDelete = inactiveReleases.length;

  console.log(`Found ${numReleasesToDelete} inactive releases to delete`);

  const pullRequestNumbers = [];

  for (const release of inactiveReleases) {
    const environment = release.namespace.replace("prv-", "");
    const pullRequestNumber = environment.replace("pr-", "");
    const namespace = release.namespace;
    console.log(`Deleting environment ${environment} in namespace ${namespace}`);
    childProcess.execSync(`helmfile --state-values-set environment=${environment},namespace=${namespace} destroy`);
    childProcess.execSync(`kubectl delete namespace ${release.namespace}`);
    pullRequestNumbers.push(pullRequestNumber);
  }

  console.log(`Deleted ${numReleasesToDelete} inactive releases`);

  // Write to local file - inactive-pull-requests.json
  fs.writeFileSync("inactive-pull-requests.json", JSON.stringify(pullRequestNumbers));
}

main();