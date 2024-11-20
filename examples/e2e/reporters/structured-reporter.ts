// reporters/structured-reporter.ts
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import json2md from "json2md";
import { getConfigs, ConfigMap, ConfigItem } from "../lib/config-helper";
import fs from "fs";
import path from "path";

interface StatsWithUrls {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  urls: string[];
}

interface ProjectConfigs {
  configs: {
    [description: string]: StatsWithUrls;
  };
}

interface GroupedResults {
  [projectName: string]: ProjectConfigs;
}

type MarkdownElement = {
  h1?: string;
  h2?: string;
  h3?: string;
  p?: string;
  ul?: { content: string; url: string }[];
};

export default class StructuredReporter implements Reporter {
  private groupedResults: GroupedResults = {};
  private outputFile: string;
  private configs: ConfigMap;

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile || "test-results/test-run-comment.md";
    this.configs = getConfigs();
  }

  // We know our test structure is:
  // test.describe(projectName) ->
  //   test.describe(description) ->
  //     test(`Test ${config.key} with model ${model.name}`)
  private getTestInfo(
    testTitle: string,
    testPath: string[]
  ): { configKey: string; projectName: string; description: string } | null {
    // testPath gives us the describe blocks: [projectName, description]
    // testTitle gives us the config key from the test title
    if (testPath.length < 2) return null;

    const [projectName, description] = testPath;
    const titleMatch = testTitle.match(/Test ([\w-]+) with model/);
    if (!titleMatch) return null;

    return {
      configKey: titleMatch[1],
      projectName,
      description,
    };
  }

  onBegin(config: FullConfig, suite: Suite) {
    suite.allTests().forEach((test) => {
      const testInfo = this.getTestInfo(test.title, test.titlePath());

      if (!testInfo) {
        return;
      }

      const { projectName, description } = testInfo;

      if (!this.groupedResults[projectName]) {
        this.groupedResults[projectName] = {
          configs: {},
        };
      }

      if (!this.groupedResults[projectName].configs[description]) {
        const testConfig = this.configs[testInfo.configKey];
        if (!testConfig) {
          console.warn(`No config found for key: ${testInfo.configKey}`);
          return;
        }

        this.groupedResults[projectName].configs[description] = {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          urls: [testConfig.url],
        };
      }
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testInfo = this.getTestInfo(test.title, test.titlePath());
    if (!testInfo) return;

    const { projectName, description } = testInfo;
    const projectStats = this.groupedResults[projectName]?.configs[description];
    if (!projectStats) return;

    projectStats.total++;
    switch (result.status) {
      case "passed":
        projectStats.passed++;
        break;
      case "skipped":
        projectStats.skipped++;
        break;
      case "failed":
      case "timedOut":
        projectStats.failed++;
        break;
    }
  }

  onEnd(result: FullResult) {
    const mdStructure: MarkdownElement[] = [];
    mdStructure.push({ h1: "Test Results" });

    Object.entries(this.groupedResults).forEach(([projectName, data]) => {
      mdStructure.push({ h2: projectName });

      Object.entries(data.configs).forEach(([description, stats]) => {
        mdStructure.push({ h3: description });

        let results = `${stats.passed}/${stats.total} passed`;
        if (stats.failed > 0) results += ` • ${stats.failed} failed`;
        if (stats.skipped > 0) results += ` • ${stats.skipped} skipped`;
        mdStructure.push({ p: results });

        if (stats.urls.length > 0) {
          mdStructure.push({
            ul: stats.urls.map((url) => ({ content: url, url })),
          });
        }
      });
    });

    const outputDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, json2md(mdStructure));
  }
}
