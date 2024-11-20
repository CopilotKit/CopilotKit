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
import { ConfigMap, getConfigs } from "../lib/config-helper";

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
        };
      }
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testInfo = this.getTestInfo(test.title, test.titlePath());
    if (!testInfo) return;

    const { projectName, description, browser, variant } = testInfo;
    const stats =
      this.groupedResults[projectName]?.[description]?.[variant]?.[browser];
    if (!stats) return;

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

  private calculateSummaryStats() {
    let totalTests = 0;
    let totalFailed = 0;
    let affectedAreas = new Set<string>();
    let failingModels = new Map<string, number>();

    for (const [, descriptions] of Object.entries(this.groupedResults)) {
      for (const [description, variants] of Object.entries(descriptions)) {
        for (const [variant, browsers] of Object.entries(variants)) {
          for (const [, stats] of Object.entries(browsers)) {
            totalTests += stats.total;
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

  onEnd(result: FullResult) {
    const stats = this.calculateSummaryStats();
    const passRate = (
      ((stats.totalTests - stats.totalFailed) / stats.totalTests) *
      100
    ).toFixed(1);

    const parts = [
      "# Test Results\n\n",
      `**Status**: ${result.status === "passed" ? "✅ Passed" : "❌ Failed"}\n`,
      `**Duration**: ${(result.duration / 1000).toFixed(1)}s\n`,
      `**Total Tests**: ${stats.totalTests}\n`,
      `**Pass Rate**: ${passRate}%\n\n`,

      "## 📊 Summary\n",
      `- Total Failures: ${stats.totalFailed}\n`,
      `- Affected Areas: ${stats.affectedAreas.join(", ")}\n`,
      `- Failing Models: ${Object.entries(stats.failingModels)
        .map(([model, count]) => `${model} (${count} tests)`)
        .join(", ")}\n\n`,

      "## 🔍 Detailed Results\n",
    ];

    // Add detailed results
    for (const [projectName, descriptions] of Object.entries(
      this.groupedResults
    )) {
      parts.push(`### ${projectName}\n\n`);

      for (const [description, variants] of Object.entries(descriptions)) {
        parts.push(`#### ${description.replace(" Dependencies", "")}\n`);
        parts.push("| Model | Browser | Status | Details |\n");
        parts.push("|-------|---------|---------|---------|\n");

        for (const [variant, browsers] of Object.entries(variants)) {
          for (const [browser, stats] of Object.entries(browsers)) {
            const status = stats.failed > 0 ? "❌ FAILED" : "✅ PASSED";
            parts.push(
              `| ${variant} | ${browser} | ${status} | ${stats.passed}/${stats.total} passed |\n`
            );
          }
        }
        parts.push("\n");
      }
    }

    // Add analysis if there are failures
    if (stats.totalFailed > 0) {
      parts.push("## 💡 Quick Analysis\n");
      if (stats.totalFailed === stats.totalTests) {
        parts.push("- All tests failing\n");
      }
      if (stats.affectedAreas.length > 1) {
        parts.push(
          `- Multiple areas affected: ${stats.affectedAreas.join(", ")}\n`
        );
      }

      parts.push("\n## 🏃 Next Steps\n");
      parts.push("1. Check model connectivity\n");
      parts.push("2. Review recent changes\n");
      parts.push("3. Verify test configurations\n");
    }

    const outputDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, parts.join(""), "utf8");
  }
}
