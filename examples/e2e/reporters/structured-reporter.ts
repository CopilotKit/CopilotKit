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

  private getTestInfo(testTitle: string, testPath: string[]) {
    if (testPath.length < 6) return null;

    const projectName = testPath[3];
    const description = testPath[4];
    const browser = testPath[1];
    const title = testPath[5];
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
    suite.allTests().forEach((test) => {
      const testInfo = this.getTestInfo(test.title, test.titlePath());
      if (!testInfo) return;

      const { projectName, description, browser, variant } = testInfo;

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
        this.groupedResults[projectName][description][variant][browser] = {
          total: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
          testCases: new Map(),
        };
      }
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testInfo = this.getTestInfo(test.title, test.titlePath());
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
    testCase.results.push(result);
    stats.testCases.set(testId, testCase);

    // Update counters when we have all results
    if (testCase.results.length === test.retries + 1) {
      stats.total++;

      const finalResult = this.determineTestStatus(testCase.results);
      switch (finalResult) {
        case "passed":
          stats.passed++;
          break;
        case "flaky":
          stats.flaky++;
          stats.passed++; // Count flaky as ultimately passed
          break;
        case "skipped":
          stats.skipped++;
          break;
        case "failed":
          stats.failed++;
          break;
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
    let totalTests = 0;
    let totalFailed = 0;
    let totalFlaky = 0;
    let affectedAreas = new Set<string>();
    let failingModels = new Map<string, number>();

    for (const [, descriptions] of Object.entries(this.groupedResults)) {
      for (const [description, variants] of Object.entries(descriptions)) {
        for (const [variant, browsers] of Object.entries(variants)) {
          for (const [, stats] of Object.entries(browsers)) {
            totalTests += stats.total;
            totalFailed += stats.failed;
            totalFlaky += stats.flaky;
            if (stats.failed > 0) {
              affectedAreas.add(description);
              failingModels.set(variant, (failingModels.get(variant) || 0) + 1);
            }
          }
        }
      }
    }

    return {
      totalTests,
      totalFailed,
      totalFlaky,
      affectedAreas: Array.from(affectedAreas),
      failingModels: Object.fromEntries(failingModels),
    };
  }

  private getGitHubActionRunUrl(): string {
    const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
    const repository = process.env.GITHUB_REPOSITORY || "";
    const runId = process.env.GITHUB_RUN_ID || "";

    return `${serverUrl}/${repository}/actions/runs/${runId}`;
  }

  private formatTestLocation(file: string, line: number): string {
    const repoRoot = process.env.GITHUB_WORKSPACE || "";
    const relativeFile = file.replace(repoRoot, "").replace(/^\//, "");
    const repository = process.env.GITHUB_REPOSITORY || "";
    const branch = process.env.GITHUB_REF_NAME || "main";

    return `https://github.com/${repository}/blob/${branch}/${relativeFile}#L${line}`;
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

  private generateFlakyTestsSection() {
    const flakyTests: string[] = [];

    Object.entries(this.groupedResults).forEach(([, descriptions]) => {
      Object.entries(descriptions).forEach(([description, variants]) => {
        Object.entries(variants).forEach(([variant, browsers]) => {
          Object.entries(browsers).forEach(([browser, stats]) => {
            stats.testCases.forEach((testCase, testId) => {
              if (this.determineTestStatus(testCase.results) === "flaky") {
                const location = this.formatTestLocation(
                  testCase.file,
                  testCase.line
                );
                const retryCount = testCase.results.length - 1;
                flakyTests.push(
                  `- [${
                    testCase.title
                  }](${location})\n  - Variant: ${variant}\n  - Browser: ${browser}\n  - Passed after ${retryCount} ${
                    retryCount === 1 ? "retry" : "retries"
                  }`
                );
              }
            });
          });
        });
      });
    });

    return { ul: flakyTests };
  }

  private getLastError(results: TestResult[]): string {
    for (let i = results.length - 1; i >= 0; i--) {
      const error = results[i].error;
      if (results[i].status === "failed" && error?.message) {
        return error.message.split("\n")[0]; // First line of error
      }
    }
    return "No error message available";
  }

  onEnd(result: FullResult) {
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
          `**Flaky Tests**: ${stats.totalFlaky}`,
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

    // Add flaky tests section if there are any
    if (stats.totalFlaky > 0) {
      mdContent.push(
        { h2: "⚠️ Flaky Tests" },
        this.generateFlakyTestsSection()
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
                headers: ["Model", "Browser", "Status", "Details"],
                rows: Object.entries(variants).flatMap(([variant, browsers]) =>
                  Object.entries(browsers).map(([browser, stats]) => {
                    let status = "✅ PASSED";
                    if (stats.failed > 0) status = "❌ FAILED";
                    else if (stats.flaky > 0) status = "⚠️ FLAKY";

                    return [
                      variant,
                      browser,
                      status,
                      `${stats.passed}/${stats.total} passed${
                        stats.flaky > 0 ? ` (${stats.flaky} flaky)` : ""
                      }`,
                    ];
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

    fs.writeFileSync(this.outputFile, json2md(mdContent as any), "utf8");
  }
}
