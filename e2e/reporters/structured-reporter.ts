import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";
import json2md from "json2md";
import { ConfigMap, getConfigs } from "../lib/config-helper";
import { uploadVideos, VideoToUpload } from "../lib/upload-video";

// Define custom types
type MarkdownContent = {
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  p?: string | string[];
  ul?: string[];
  ol?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
  tableWithAlignment?: {
    headers: string[];
    rows: string[][];
  };
};

type TableInput = {
  headers: string[];
  rows: string[][];
};

const videosToUpload: VideoToUpload[] = [];

// Add custom converter for aligned tables
(json2md as any).converters.tableWithAlignment = function (input: TableInput) {
  if (!input.headers || !input.rows) return "";

  const header = `| ${input.headers
    .map((h: string) => h.padEnd(8))
    .join(" | ")} |\n`;
  const separator = `| ${input.headers.map(() => "--------").join(" | ")} |\n`;
  const rows = input.rows
    .map(
      (row: string[]) =>
        `| ${row.map((cell: string) => cell.padEnd(8)).join(" | ")} |`
    )
    .join("\n");

  return `${header}${separator}${rows}\n`;
};

export const extractVariant = (description: string) =>
  description.split("variant ").at(1) as string;

export default class StructuredReporter implements Reporter {
  private groupedResults: {
    [projectName: string]: {
      [description: string]: {
        [variant: string]: {
          [browser: string]: {
            total: number;
            passed: number;
            failed: number;
            flaky: number;
            skipped: number;
            testCases: Map<
              string,
              {
                results: TestResult[];
                title: string;
                file: string;
                line: number;
                videoPath?: string;
              }
            >;
          };
        };
      };
    };
  } = {};
  private outputFile: string;
  private configs: ConfigMap;

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile || "test-results/test-run-comment.md";
    this.configs = getConfigs();
  }

  private initializeTestStats() {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      testCases: new Map(),
    };
  }

  private getTestInfo(test: TestCase) {
    const testPath = test.titlePath();
    if (testPath.length < 6) return null;

    const projectName = testPath[3];
    const description = testPath[4];
    const browser = testPath[1];
    const title = test.title;
    const variant = extractVariant(title);

    return {
      browser,
      description,
      projectName,
      variant,
      testId: `${projectName}:${description}:${variant}:${title}`,
    };
  }

  onBegin(config: FullConfig, suite: Suite) {
    const allTests = suite.allTests();

    // Pre-process tests to count them by their groupings
    const testCounts = new Map<string, number>();

    allTests.forEach((test) => {
      const testInfo = this.getTestInfo(test);
      if (!testInfo) return;

      const { projectName, description, browser, variant } = testInfo;
      const key = `${projectName}:${description}:${variant}:${browser}`;
      testCounts.set(key, (testCounts.get(key) || 0) + 1);

      // Initialize the structure if needed
      if (!this.groupedResults[projectName]) {
        this.groupedResults[projectName] = {};
      }
      if (!this.groupedResults[projectName][description]) {
        this.groupedResults[projectName][description] = {};
      }
      if (!this.groupedResults[projectName][description][variant]) {
        this.groupedResults[projectName][description][variant] = {};
      }
      if (!this.groupedResults[projectName][description][variant][browser]) {
        this.groupedResults[projectName][description][variant][browser] =
          this.initializeTestStats();
      }

      // Set the expected total
      const stats =
        this.groupedResults[projectName][description][variant][browser];
      stats.total = testCounts.get(key) || 0;
    });
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    const testInfo = this.getTestInfo(test);
    if (!testInfo) return;

    const { projectName, description, browser, variant, testId } = testInfo;
    const stats =
      this.groupedResults[projectName]?.[description]?.[variant]?.[browser];
    if (!stats) return;

    // Get or initialize the test case data
    let testCase = stats.testCases.get(testId) || {
      results: [],
      title: test.title,
      file: test.location.file,
      line: test.location.line,
    };

    // Add this result
    testCase.results.push(result);
    stats.testCases.set(testId, testCase);

    // Only update pass/fail counts when we have all results for this test
    if (testCase.results.length === (test.retries ?? 0) + 1) {
      const lastResult = testCase.results[testCase.results.length - 1];
      const hadFailures = testCase.results.some(
        (r) => r.status === "failed" || r.status === "timedOut"
      );

      // Add video logging here
      if (lastResult.status === "failed" || lastResult.status === "timedOut") {
        const videoAttachment = lastResult.attachments.find(
          (a) => a.name === "video"
        );
        if (videoAttachment?.path) {
          const split = videoAttachment.path.split("/");
          const fileName = split[split.length - 2] + ".webm";
          const objectPath = `github-runs/${process.env.GITHUB_ACTIONS_RUN_ID}/${projectName}/${fileName}`;
          const videoUrl = `https://us-east-1.console.aws.amazon.com/s3/object/copilotkit-e2e-test-recordings?region=us-east-1&bucketType=general&prefix=${objectPath}`;
          testCase.videoPath = videoUrl;
          videosToUpload.push({
            s3ObjectPath: objectPath,
            videoPath: videoAttachment.path,
          });
        }
      }

      if (lastResult.status === "skipped") {
        stats.skipped++;
      } else if (
        lastResult.status === "failed" ||
        lastResult.status === "timedOut"
      ) {
        stats.failed++;
      } else if (hadFailures) {
        stats.flaky++;
        stats.passed++; // Count as passed since it eventually succeeded
      } else {
        stats.passed++;
      }
    }
  }

  private determineTestStatus(
    results: TestResult[]
  ): "passed" | "failed" | "flaky" | "skipped" {
    if (results.length === 0) return "skipped";

    const lastResult = results[results.length - 1];
    if (lastResult.status === "skipped") return "skipped";

    // If the last run passed but there were failures before, it's flaky
    if (
      lastResult.status === "passed" &&
      results.some((r) => r.status === "failed")
    ) {
      return "flaky";
    }

    // If the last run failed, it's a failure
    if (lastResult.status === "failed" || lastResult.status === "timedOut") {
      return "failed";
    }

    // If we got here, all runs passed
    return "passed";
  }

  private calculateSummaryStats() {
    let totals = {
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      totalFlaky: 0,
      totalSkipped: 0,
      affectedAreas: new Set<string>(),
      failingModels: new Map<string, number>(),
    };

    Object.entries(this.groupedResults).forEach(([, descriptions]) => {
      Object.entries(descriptions).forEach(([description, variants]) => {
        Object.entries(variants).forEach(([variant, browsers]) => {
          Object.entries(browsers).forEach(([, stats]) => {
            // Use the pre-set total from onBegin
            totals.totalTests += stats.total;
            totals.totalPassed += stats.passed;
            totals.totalFailed += stats.failed;
            totals.totalFlaky += stats.flaky;
            totals.totalSkipped += stats.skipped;

            if (stats.failed > 0) {
              totals.affectedAreas.add(description);
              totals.failingModels.set(
                variant,
                (totals.failingModels.get(variant) || 0) + 1
              );
            }
          });
        });
      });
    });

    return {
      totalTests: totals.totalTests,
      totalPassed: totals.totalPassed,
      totalFailed: totals.totalFailed,
      totalFlaky: totals.totalFlaky,
      totalSkipped: totals.totalSkipped,
      affectedAreas: Array.from(totals.affectedAreas),
      failingModels: Object.fromEntries(totals.failingModels),
    };
  }

  private getGitHubActionRunUrl(): string {
    const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
    const repository = process.env.GITHUB_REPOSITORY || "";
    const runId = process.env.GITHUB_RUN_ID || "";

    return `${serverUrl}/${repository}/actions/runs/${runId}`;
  }

  private formatTestLocation(file: string, line: number): string {
    // Remove local path parts and ensure correct GitHub URL structure
    const relativePath = file.split("/examples/")[1] || file;
    const repository = process.env.GITHUB_REPOSITORY || "";
    const branch = process.env.GITHUB_REF_NAME || "main";

    return `https://github.com/${repository}/blob/${branch}/examples/${relativePath}#L${line}`;
  }

  private generateFailedTestsSection() {
    const failedTests: string[] = [];

    Object.entries(this.groupedResults).forEach(([, descriptions]) => {
      Object.entries(descriptions).forEach(([description, variants]) => {
        Object.entries(variants).forEach(([variant, browsers]) => {
          Object.entries(browsers).forEach(([browser, stats]) => {
            stats.testCases.forEach((testCase, testId) => {
              if (this.determineTestStatus(testCase.results) === "failed") {
                const location = this.formatTestLocation(
                  testCase.file,
                  testCase.line
                );
                failedTests.push(
                  `- [${
                    testCase.title
                  }](${location})\n  - Variant: ${variant}\n  - Browser: ${browser}\n  - Error: ${this.getLastError(
                    testCase.results
                  )}`
                );
              }
            });
          });
        });
      });
    });

    return { ul: failedTests };
  }

  private getLastError(results: TestResult[]): string {
    for (let i = results.length - 1; i >= 0; i--) {
      const error = results[i].error;
      if (results[i].status === "failed" && error?.message) {
        if (error.message.includes("Timed out")) {
          const timeoutMs = error.message.match(/Timed out (\d+)ms/)?.[1];
          const seconds = timeoutMs ? Number(timeoutMs) / 1000 : null;
          return `Timed out after ${seconds}s waiting for element to have text`;
        }
        return this.cleanErrorMessage(error.message);
      }
    }
    return "No error message available";
  }

  async onEnd(result: FullResult) {
    const stats = this.calculateSummaryStats();
    const actionRunUrl = this.getGitHubActionRunUrl();

    const passRate =
      stats.totalTests === 0
        ? "0.0"
        : (
            ((stats.totalTests - stats.totalFailed) / stats.totalTests) *
            100
          ).toFixed(1);

    const commitSha = process.env.GITHUB_SHA || "unknown";
    const shortSha = commitSha.substring(0, 7);
    const commitLink = `[${shortSha}](https://github.com/CopilotKit/CopilotKit/commit/${commitSha})`;

    const mdContent: MarkdownContent[] = [
      { h1: "Test Results" },
      {
        p: [
          `**Status**: ${
            stats.totalFailed === 0 ? "✅ Passed" : "❌ Failed"
          } ([View Run](${actionRunUrl}))`,
          `**Commit**: ${commitLink}`,
          `**Duration**: ${(result.duration / 1000).toFixed(1)}s`,
          `**Total Tests**: ${stats.totalTests}`,
          `**Pass Rate**: ${passRate}%`,
          `**Failed Tests**: ${stats.totalFailed}`,
        ],
      },
    ];

    // Add failures section if there are any
    if (stats.totalFailed > 0) {
      mdContent.push(
        { h2: "❌ Failed Tests" },
        this.generateFailedTestsSection()
      );
    }

    mdContent.push({ h2: "🔍 Detailed Results" });

    // Generate detailed results
    Object.entries(this.groupedResults).forEach(
      ([projectName, descriptions]) => {
        mdContent.push({ h3: projectName });

        Object.entries(descriptions).forEach(([description, variants]) => {
          mdContent.push(
            { h4: description.replace(" Dependencies", "") },
            {
              tableWithAlignment: {
                headers: ["Model", "Browser", "Status", "Video"],
                rows: Object.entries(variants).flatMap(([variant, browsers]) =>
                  Object.entries(browsers).map(([browser, stats]) => {
                    let status = "✅ PASSED";
                    if (stats.failed > 0) status = "❌ FAILED";
                    else if (stats.flaky > 0) status = "⚠️ FLAKY";

                    // Collect video URLs from failed tests
                    const videoLinks = Array.from(stats.testCases.values())
                      .filter(tc => tc.videoPath)
                      .map(tc => `[Video](${tc.videoPath})`)
                      .join(", ");

                    return [variant, browser, status, videoLinks || "-"];
                  })
                ),
              },
            }
          );
        });
      }
    );

    // Write the report
    const outputDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await uploadVideos(videosToUpload);
    fs.writeFileSync(this.outputFile, json2md(mdContent as any), "utf8");
  }

  private cleanErrorMessage(error: string): string {
    // Remove ANSI color and formatting codes
    return error
      .replace(/\u001b\[\d+m/g, "")
      .replace(/\[\d+m/g, "")
      .replace(/\[2m/g, "")
      .replace(/\[22m/g, "")
      .replace(/Error:\s+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
