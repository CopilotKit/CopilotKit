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

export default class StructuredReporter implements Reporter {
  private groupedResults: {
    [projectName: string]: {
      [description: string]: {
        [browser: string]: {
          total: number;
          passed: number;
          failed: number;
          skipped: number;
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

    return {
      projectName,
      description,
      browser,
    };
  }

  onBegin(config: FullConfig, suite: Suite) {
    suite.allTests().forEach((test) => {
      const testInfo = this.getTestInfo(test.title, test.titlePath());
      if (!testInfo) return;

      const { projectName, description, browser } = testInfo;

      if (!this.groupedResults[projectName]) {
        this.groupedResults[projectName] = {};
      }
      if (!this.groupedResults[projectName][description]) {
        this.groupedResults[projectName][description] = {};
      }
      if (!this.groupedResults[projectName][description][browser]) {
        this.groupedResults[projectName][description][browser] = {
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

    const { projectName, description, browser } = testInfo;
    const stats = this.groupedResults[projectName]?.[description]?.[browser];
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

  onEnd(result: FullResult) {
    const parts = ["# Test Results\n"];

    // Add overall status
    parts.push(`\nStatus: ${result.status}\n`);
    parts.push(`\nDuration: ${(result.duration / 1000).toFixed(1)}s\n\n`);

    const sortedProjects = Object.entries(this.groupedResults).sort(
      ([nameA], [nameB]) => nameA.localeCompare(nameB)
    );

    for (const [projectName, descriptions] of sortedProjects) {
      parts.push(`## ${projectName}\n`);

      for (const [description, browsers] of Object.entries(descriptions)) {
        parts.push(`### ${description}\n`);

        for (const [browser, stats] of Object.entries(browsers)) {
          const resultParts: string[] = [];
          resultParts.push(`${stats.passed}/${stats.total} passed`);
          if (stats.failed > 0) resultParts.push(`${stats.failed} failed`);
          if (stats.skipped > 0) resultParts.push(`${stats.skipped} skipped`);

          parts.push(`${browser} → ${resultParts.join(" • ")}\n\n`);
        }
        parts.push("\n");
      }
    }

    const outputDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, parts.join(""), "utf8");
  }
}
