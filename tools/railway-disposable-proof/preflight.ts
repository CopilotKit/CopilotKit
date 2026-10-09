/** Offline diagnosis only. Never provisions resources or authorizes deployment. */
import { execFileSync } from "node:child_process";
import {
  SERVICES,
  computePromoteClosure,
} from "../../showcase/scripts/railway-envs";
import {
  findMissingServices,
  findUntrackedServices,
  validateImage,
} from "../../showcase/scripts/verify-railway-image-refs";

const name = "test-pni595-offline-proof";
if (SERVICES[name]) throw new Error("Synthetic name collides with registry");
const composite =
  "ghcr.io/copilotkit/intelligence/composite@sha256:1bc9dbc634a8b713af7dcf19266eb2b514cdfa3c7e7858476a6ebe5fced45f1d";
const flags = [];
try {
  for (const gateValidated of [false, true]) {
    for (const gateIgnore of [false, true]) {
      SERVICES[name] = {
        ...SERVICES["showcase-mastra"],
        gateValidated,
        gateIgnore,
      };
      // Mirrors main's filter. This is helper-level evidence, not live gate execution.
      const presentSeen = new Set(gateValidated && !gateIgnore ? [name] : []);
      flags.push({
        gateValidated,
        gateIgnore,
        absentRequired: findMissingServices("staging", new Set()).includes(
          name,
        ),
        presentReportedMissing: findMissingServices(
          "staging",
          presentSeen,
        ).includes(name),
        imageCheckedWhenPresent: gateValidated && !gateIgnore,
      });
    }
  }
} finally {
  delete SERVICES[name];
}
const ignoredConsumer = computePromoteClosure(["showcase-mastra"], {
  ...SERVICES,
  [name]: {
    ...SERVICES["showcase-mastra"],
    imageOf: "showcase-mastra",
    gateIgnore: true,
  },
});
const ruby = execFileSync(
  "ruby",
  [
    "-EUTF-8",
    "-e",
    `
require "json"
load "./showcase/bin/railway"
command = Railway::PromoteCommand.new([])
puts JSON.generate(command.send(:check_service_set_parity,
  {"services" => [{"name" => "${name}"}]}, {"services" => []}))
`,
  ],
  { encoding: "utf8", timeout: 10000 },
);
const findings = {
  unknownService: findUntrackedServices(new Set([name])),
  pinnedCompositeStaging: validateImage(composite, {
    env: "staging",
    repoName: "intelligence/composite",
  }),
  pinnedCompositeProduction: validateImage(composite, {
    env: "prod",
    repoName: "intelligence/composite",
  }),
  flags,
  ignoredConsumerPromoted: ignoredConsumer.services.some(
    (service) => service.name === name,
  ),
  rubyFleetParity: JSON.parse(ruby),
};
const blocked =
  findings.unknownService.length > 0 ||
  findings.pinnedCompositeStaging !== null ||
  findings.ignoredConsumerPromoted ||
  findings.rubyFleetParity.length > 0;
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      evidenceKind: "offline-current-source-reproduction",
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      recordedAt: new Date().toISOString(),
      resourcesCreated: [],
      liveAcceptance: "NOT_RUN",
      verdict: blocked
        ? "BLOCKED_BY_SHARED_CONSUMERS"
        : "REQUIRES_LIVE_PREREQUISITE_REVIEW",
      findings,
    },
    null,
    2,
  ),
);
// Even after these regressions are fixed, this diagnostic cannot approve live work.
process.exitCode = blocked ? 2 : 0;
