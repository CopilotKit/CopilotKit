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

// Add custom converter
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
            skipped: number;
            testCases: Set<string>; // Track unique test cases
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
      testId: `${projectName}:${description}:${variant}:${title}`, // Unique test identifier
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
          skipped: 0,
          testCases: new Set(), // Initialize Set for tracking unique test cases
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

    // Only count if we haven't seen this test case before
    if (!stats.testCases.has(testId)) {
      stats.testCases.add(testId);
      stats.total++;

      switch (result.status) {
        case "passed":
          stats.passed++;
          break;
        case "skipped":
          stats.skipped++;
          break;
        case "failed":
        case "timedOut":
          stats.failed++;
          break;
      }
    }
  }

  private calculateSummaryStats() {
    let totalTests = 0;
    let totalFailed = 0;
    let affectedAreas = new Set<string>();
    let failingModels = new Map<string, number>();

    for (const [, descriptions] of Object.entries(this.groupedResults)) {
      for (const [description, variants] of Object.entries(descriptions)) {
        for (const [variant, browsers] of Object.entries(variants)) {
          for (const [, stats] of Object.entries(browsers)) {
            totalTests += stats.testCases.size; // Use the size of unique test cases
            totalFailed += stats.failed;
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
      affectedAreas: Array.from(affectedAreas),
      failingModels: Object.fromEntries(failingModels),
    };
  }

  // Rest of the class implementation remains the same...

  onEnd(result: FullResult) {
    const stats = this.calculateSummaryStats();
    const passRate = (
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
            result.status === "passed" ? "✅ Passed" : "❌ Failed"
          }`,
          `**Commit**: ${commitLink}`,
          `**Duration**: ${(result.duration / 1000).toFixed(1)}s`,
          `**Total Tests**: ${stats.totalTests}`,
          `**Pass Rate**: ${passRate}%`,
        ],
      },
    ];

    // Only add summary section if there are failures
    if (stats.totalFailed > 0) {
      mdContent.push(
        { h2: "📊 Summary" },
        {
          ul: [
            `Total Failures: ${stats.totalFailed}`,
            `Affected Areas: ${stats.affectedAreas.join(", ")}`,
            `Failing Models: ${Object.entries(stats.failingModels)
              .map(([model, count]) => `${model} (${count} tests)`)
              .join(", ")}`,
          ],
        }
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
                  Object.entries(browsers).map(([browser, stats]) => [
                    variant,
                    browser,
                    stats.failed > 0 ? "❌ FAILED" : "✅ PASSED",
                    `${stats.passed}/${stats.total} passed`,
                  ])
                ),
              },
            }
          );
        });
      }
    );

    // Add analysis and next steps only if there are failures
    if (stats.totalFailed > 0) {
      mdContent.push(
        { h2: "💡 Quick Analysis" },
        {
          ul: [
            ...(stats.totalFailed === stats.totalTests
              ? ["All tests failing"]
              : []),
            ...(stats.affectedAreas.length > 1
              ? [`Multiple areas affected: ${stats.affectedAreas.join(", ")}`]
              : []),
          ],
        },
        { h2: "🏃 Next Steps" },
        {
          ol: [
            "Check model connectivity",
            "Review recent changes",
            "Verify test configurations",
          ],
        }
      );
    }

    // Convert to markdown and clean up extra newlines
    let markdown = json2md(mdContent as any);

    // Clean up extra newlines while preserving formatting
    markdown = markdown
      .replace(/\n{3,}/g, "\n\n") // Replace 3+ newlines with 2
      .replace(/(\|.*\|\n)\n+(?=\|)/g, "$1") // Remove extra newlines in tables
      .replace(/(\n\n)(#+\s)/g, "$1$2"); // Preserve spacing before headers

    const outputDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, markdown, "utf8");
  }
}
