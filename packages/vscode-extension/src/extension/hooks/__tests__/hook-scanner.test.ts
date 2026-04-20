import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { scanFile, scanWorkspace } from "../hook-scanner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fx = (name: string) => path.join(__dirname, "fixtures", name);

describe("hook-scanner scanFile", () => {
  it("detects a direct import + hook call and pins loc to the exact source line", () => {
    const sites = scanFile(fx("direct-import.tsx"));
    expect(sites).toHaveLength(1);
    // direct-import.tsx line 4 is `  useCopilotAction({`; call closes on line 9.
    expect(sites[0].loc.line).toBe(4);
    expect(sites[0].loc.endLine).toBe(9);
    expect(sites[0]).toMatchObject({
      hook: "useCopilotAction",
      name: "addTodo",
      category: "render",
    });
  });

  it("detects aliased imports", () => {
    const sites = scanFile(fx("aliased-import.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].hook).toBe("useCopilotAction");
    expect(sites[0].name).toBe("aliasedAction");
  });

  it("detects /v2 imports", () => {
    const sites = scanFile(fx("v2-import.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].hook).toBe("useRenderTool");
    expect(sites[0].name).toBe("v2tool");
  });

  it("detects multiple hooks per file", () => {
    const sites = scanFile(fx("multiple-hooks.tsx"));
    expect(sites).toHaveLength(3);
    const names = sites.map((s) => `${s.hook}:${s.name ?? "-"}`).sort();
    expect(names).toEqual([
      "useCopilotAction:a",
      "useCopilotAction:b",
      "useCopilotReadable:-",
    ]);
  });

  it("marks dynamic names as null", () => {
    const sites = scanFile(fx("dynamic-name.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBeNull();
  });

  it("returns empty for files without CopilotKit imports", () => {
    expect(scanFile(fx("not-copilotkit.tsx"))).toEqual([]);
  });

  it("returns empty for nonexistent files without throwing", () => {
    expect(scanFile(fx("does-not-exist.tsx"))).toEqual([]);
  });
});

describe("hook-scanner scanWorkspace", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hook-scan-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  it("walks workspace and collects hook sites from multiple files", () => {
    write(
      "src/a.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"x",render:()=>null}); return null; }`,
    );
    write(
      "src/b.tsx",
      `import { useCopilotReadable } from "@copilotkit/react-core";\nexport function B(){ useCopilotReadable({description:"d",value:1}); return null; }`,
    );
    const sites = scanWorkspace(tmp).sites;
    expect(sites.map((s) => s.hook).sort()).toEqual([
      "useCopilotAction",
      "useCopilotReadable",
    ]);
  });

  it("skips node_modules, dist, .git", () => {
    write(
      "node_modules/lib/x.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"n",render:()=>null}); return null; }`,
    );
    write(
      "dist/x.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"n",render:()=>null}); return null; }`,
    );
    write(
      ".git/x.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"n",render:()=>null}); return null; }`,
    );
    expect(scanWorkspace(tmp).sites).toEqual([]);
  });

  it("respects .gitignore patterns", () => {
    write(".gitignore", "generated/\n*.ignore.tsx\n");
    write(
      "generated/x.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"ign",render:()=>null}); return null; }`,
    );
    write(
      "src/foo.ignore.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"ign2",render:()=>null}); return null; }`,
    );
    write(
      "src/ok.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"ok",render:()=>null}); return null; }`,
    );
    const sites = scanWorkspace(tmp).sites;
    expect(sites.map((s) => s.name)).toEqual(["ok"]);
  });

  it("respects nested .gitignore", () => {
    write("src/feature/.gitignore", "internal/\n");
    write(
      "src/feature/internal/x.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"nope",render:()=>null}); return null; }`,
    );
    write(
      "src/feature/ok.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function X(){ useCopilotAction({name:"yes",render:()=>null}); return null; }`,
    );
    const sites = scanWorkspace(tmp).sites;
    expect(sites.map((s) => s.name)).toEqual(["yes"]);
  });

  it("skips *.test.tsx / *.spec.tsx / *.stories.tsx by default", () => {
    write(
      "src/a.test.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"t",render:()=>null}); return null; }`,
    );
    write(
      "src/a.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"a",render:()=>null}); return null; }`,
    );
    const sites = scanWorkspace(tmp).sites;
    expect(sites.map((s) => s.name)).toEqual(["a"]);
  });

  it("skips files under __tests__, __fixtures__, and __mocks__ directories", () => {
    write(
      "src/__tests__/fixtures/fixture.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"testsFixture",render:()=>null}); return null; }`,
    );
    write(
      "src/__fixtures__/fake.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"fixtures",render:()=>null}); return null; }`,
    );
    write(
      "src/__mocks__/fake.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function A(){ useCopilotAction({name:"mocks",render:()=>null}); return null; }`,
    );
    write(
      "src/real.tsx",
      `import { useCopilotAction } from "@copilotkit/react-core";\nexport function R(){ useCopilotAction({name:"real",render:()=>null}); return null; }`,
    );
    const sites = scanWorkspace(tmp).sites;
    expect(sites.map((s) => s.name)).toEqual(["real"]);
  });
});
