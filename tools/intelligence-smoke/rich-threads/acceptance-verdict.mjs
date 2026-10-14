import { milestone, frameworks } from "./contract.mjs";

/** Supervisor success includes reconciliation, even for an expected worker failure. */
export function acceptanceVerdict({
  report,
  supervisorExit,
  intentional = false,
  cancelled = false,
}) {
  return (
    !cancelled &&
    supervisorExit === 0 &&
    report.milestone === milestone &&
    report.provider === "railway" &&
    report.purpose === "acceptance" &&
    report.cleanup === "passed" &&
    report.harnessSuccess === true &&
    Array.isArray(report.frameworks) &&
    report.frameworks.length === frameworks.length &&
    frameworks.every(
      (framework) =>
        report.frameworks.filter(
          (item) => item.framework === framework && item.status === "passed",
        ).length === 1,
    ) &&
    (intentional
      ? report.status === "failed" &&
        report.failureControl?.injected === true &&
        report.failureControl.stage === "after-real-journeys"
      : report.status === "passed" && !report.failureControl)
  );
}
