import { describe, it, expect } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "../remove-stylesheet-import";

const j = jscodeshift.withParser("tsx");

function run(source: string, path = "test.tsx") {
  const reports: string[] = [];
  const result = transform(
    { source, path },
    {
      jscodeshift: j,
      j,
      stats: () => {},
      report: (message: string) => reports.push(message),
    },
  );
  return { output: result ?? source, changed: result !== undefined, reports };
}

describe("remove-stylesheet-import codemod", () => {
  describe("JS and TS files", () => {
    it("removes only the import line and leaves the rest of the file byte-for-byte", () => {
      const { output, changed } = run(`"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./app.css";

export default function Page({ wide }: { wide: boolean }) {
  return wide ? (
    // Desktop
    <>
      <CopilotChat />
    </>
  ) : (
    <CopilotChat />
  );
}
`);

      expect(changed).toBe(true);
      expect(output).toBe(`"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import "./app.css";

export default function Page({ wide }: { wide: boolean }) {
  return wide ? (
    // Desktop
    <>
      <CopilotChat />
    </>
  ) : (
    <CopilotChat />
  );
}
`);
    });

    it("removes the react-ui re-export and the built dist path", () => {
      const { output } = run(`import "@copilotkit/react-ui/v2/styles.css";
import "@copilotkit/react-core/dist/v2/index.css";
import { App } from "./App";
`);

      expect(output).not.toContain("@copilotkit/react-ui/v2/styles.css");
      expect(output).not.toContain("@copilotkit/react-core/dist/v2/index.css");
      expect(output).toContain('import { App } from "./App";');
    });

    it("keeps a comment that sat above the removed import", () => {
      const { output } = run(`// Copyright Acme Inc.
import "@copilotkit/react-core/v2/styles.css";
import { App } from "./App";
`);

      expect(output).toBe(`// Copyright Acme Inc.
import { App } from "./App";
`);
    });

    it("removes a require statement", () => {
      const { output, changed } = run(
        `require("@copilotkit/react-core/v2/styles.css");
const App = require("./App");
`,
        "test.js",
      );

      expect(changed).toBe(true);
      expect(output).not.toContain("styles.css");
      expect(output).toContain('const App = require("./App");');
    });

    it("leaves an import that binds a name, and reports it", () => {
      const source = `import styles from "@copilotkit/react-core/v2/styles.css";
console.log(styles);
`;
      const { output, changed, reports } = run(source);

      expect(changed).toBe(false);
      expect(output).toBe(source);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain("remove it by hand");
    });

    it("does not change a file without the import", () => {
      const { changed } = run(`import "./styles.css";
import "@copilotkit/react-core/v2";
`);

      expect(changed).toBe(false);
    });

    it("removes the v1 react-ui and the 2.0 release-candidate stylesheets", () => {
      const { output, changed } =
        run(`import { CopilotChat } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import "@copilotkit/react-core/styles.css";
import "./app.css";
`);

      expect(changed).toBe(true);
      expect(output).toBe(`import { CopilotChat } from "@copilotkit/react-core";
import "./app.css";
`);
    });
  });

  describe("CSS files", () => {
    it("removes every @import form of the stylesheets and keeps other imports", () => {
      const { output, changed } = run(
        `@import "tailwindcss";
@import "@copilotkit/react-core/v2/styles.css";
@import '@copilotkit/react-core/v2/styles.css' layer(copilotkit);
@import url("@copilotkit/react-ui/v2/styles.css");
@import url(@copilotkit/react-core/dist/v2/index.css) screen;

:root {
  --brand: red;
}
`,
        "globals.css",
      );

      expect(changed).toBe(true);
      expect(output).toBe(`@import "tailwindcss";

:root {
  --brand: red;
}
`);
    });

    it("handles SCSS and an import on the last line without a newline", () => {
      const { output } = run(
        `$brand: red;
@import "@copilotkit/react-core/v2/styles.css";`,
        "styles.scss",
      );

      expect(output).toBe("$brand: red;\n");
    });

    it("empties a stylesheet that held only the import", () => {
      // jscodeshift skips an empty result, so the file becomes one newline.
      const { output, changed } = run(
        `@import "@copilotkit/react-core/v2/styles.css";\n`,
        "styles.css",
      );

      expect(changed).toBe(true);
      expect(output).toBe("\n");
    });

    it("does not change a stylesheet without the import", () => {
      const { changed } = run(`@import "./theme.css";`, "globals.css");

      expect(changed).toBe(false);
    });
  });
});

describe("remove-stylesheet-import codemod: Vue and Angular", () => {
  it("removes the Vue stylesheet import from a TS entry file", () => {
    const { output } = run(
      `import { createApp } from "vue";
import "@copilotkit/vue/styles.css";
import App from "./App.vue";
`,
      "src/main.ts",
    );

    expect(output).toBe(`import { createApp } from "vue";
import App from "./App.vue";
`);
  });

  it("removes the imports from a Vue single-file component", () => {
    const { output } = run(
      `<script setup lang="ts">
import "@copilotkit/vue/styles.css";
import { CopilotChat } from "@copilotkit/vue";
</script>

<style>
@import "@copilotkit/vue/styles.css";
.page { padding: 1rem; }
</style>
`,
      "src/App.vue",
    );

    expect(output).toBe(`<script setup lang="ts">
import { CopilotChat } from "@copilotkit/vue";
</script>

<style>
.page { padding: 1rem; }
</style>
`);
  });

  it("removes the Angular stylesheet from a global stylesheet, with webpack's ~", () => {
    const { output } = run(
      `@import "~@copilotkit/angular/styles.css";
@import "@copilotkit/angular/styles.css";
body { margin: 0; }
`,
      "src/styles.scss",
    );

    expect(output).toBe(`body { margin: 0; }
`);
  });

  it("removes the Angular stylesheet from every styles array in angular.json", () => {
    const angularJson = (styles: unknown[]) =>
      `${JSON.stringify(
        {
          projects: {
            app: {
              architect: {
                build: { options: { styles } },
                test: { options: { styles } },
              },
            },
          },
        },
        null,
        2,
      )}\n`;
    const { output } = run(
      angularJson([
        "node_modules/@copilotkit/angular/styles.css",
        { input: "@copilotkit/angular/styles.css", inject: true },
        "src/styles.css",
      ]),
      "angular.json",
    );

    expect(output).toBe(angularJson(["src/styles.css"]));
  });

  it("leaves other JSON files, and angular.json without the stylesheet, unchanged", () => {
    const pkg = `{ "styles": ["node_modules/@copilotkit/angular/styles.css"] }\n`;
    expect(run(pkg, "package.json").changed).toBe(false);
    expect(run(`{ "projects": {} }\n`, "apps/web/angular.json").changed).toBe(
      false,
    );
  });

  it("reports an angular.json with comments instead of failing", () => {
    const { changed, reports } = run(
      `{
  // workspace
  "styles": ["node_modules/@copilotkit/angular/styles.css"]
}
`,
      "angular.json",
    );

    expect(changed).toBe(false);
    expect(reports).toEqual([
      'angular.json: remove "@copilotkit/angular/styles.css" from "styles" by hand.',
    ]);
  });
});
