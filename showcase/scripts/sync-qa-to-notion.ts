// Sync QA Instructions to Notion
//
// Reads qa/*.md files from integration packages and syncs them
// to Notion pages under the "Showcase QA Instructions" parent page.
//
// Structure:
//   Showcase QA Instructions (parent)
//     └── LangGraph (Python) (integration page)
//           ├── Agentic Chat (feature QA page)
//           ├── Human in the Loop (feature QA page)
//           └── ...
//
// Usage:
//   NOTION_API_KEY=secret_xxx npx tsx showcase/scripts/sync-qa-to-notion.ts
//
// Environment:
//   NOTION_API_KEY     - Notion integration token (required)
//   QA_PARENT_PAGE_ID  - Notion page ID for "Showcase QA Instructions"
//                        (default: 32d3aa38-1852-81af-a1f4-d1ef37402428)
//   DRY_RUN            - Set to "true" to preview without writing (optional)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");
const FEATURE_REGISTRY_PATH = path.join(
  ROOT,
  "shared",
  "feature-registry.json",
);

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const QA_PARENT_PAGE_ID =
  process.env.QA_PARENT_PAGE_ID || "3423aa38-1852-8126-84d5-e40a2bd5a7ec";
const DRY_RUN = process.env.DRY_RUN === "true";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface Feature {
  id: string;
  name: string;
}

interface QAFile {
  integrationSlug: string;
  integrationName: string;
  featureId: string;
  featureName: string;
  content: string;
  filePath: string;
}

// --- Notion API helpers ---

async function notionRequest(
  endpoint: string,
  method: string = "GET",
  body?: any,
): Promise<any> {
  const response = await fetch(`${NOTION_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error ${response.status}: ${error}`);
  }

  return response.json();
}

async function findChildPage(
  parentId: string,
  title: string,
): Promise<string | null> {
  const result = await notionRequest(
    `/blocks/${parentId}/children?page_size=100`,
  );

  for (const block of result.results) {
    if (block.type === "child_page" && block.child_page?.title === title) {
      return block.id;
    }
  }
  return null;
}

async function createPage(
  parentId: string,
  title: string,
  icon?: string,
): Promise<string> {
  const result = await notionRequest("/pages", "POST", {
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
    ...(icon ? { icon: { emoji: icon } } : {}),
  });
  return result.id;
}

function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith("### ")) {
      blocks.push({
        type: "heading_3",
        heading_3: {
          rich_text: [{ text: { content: line.slice(4).trim() } }],
        },
      });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({
        type: "heading_2",
        heading_2: {
          rich_text: [{ text: { content: line.slice(3).trim() } }],
        },
      });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({
        type: "heading_1",
        heading_1: {
          rich_text: [{ text: { content: line.slice(2).trim() } }],
        },
      });
      i++;
      continue;
    }

    // Checkbox items (- [ ] or - [x])
    const checkboxMatch = line.match(/^- \[([ x])\] (.+)/);
    if (checkboxMatch) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: [{ text: { content: checkboxMatch[2].trim() } }],
          checked: checkboxMatch[1] === "x",
        },
      });
      i++;
      continue;
    }

    // Bullet items (- text)
    if (line.startsWith("- ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ text: { content: line.slice(2).trim() } }],
        },
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      blocks.push({ type: "divider", divider: {} });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push({
      type: "paragraph",
      paragraph: {
        rich_text: [{ text: { content: line } }],
      },
    });
    i++;
  }

  return blocks;
}

async function replacePageContent(
  pageId: string,
  blocks: any[],
): Promise<void> {
  // First, delete all existing blocks
  const existing = await notionRequest(
    `/blocks/${pageId}/children?page_size=100`,
  );
  for (const block of existing.results) {
    await notionRequest(`/blocks/${block.id}`, "DELETE");
  }

  // Then add new blocks in batches of 100 (Notion API limit)
  for (let i = 0; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    await notionRequest(`/blocks/${pageId}/children`, "PATCH", {
      children: batch,
    });
  }
}

// --- Main logic ---

function loadFeatureNames(): Map<string, string> {
  const raw = fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8");
  const registry = JSON.parse(raw);
  const map = new Map<string, string>();
  for (const feature of registry.features) {
    map.set(feature.id, feature.name);
  }
  return map;
}

function collectQAFiles(): QAFile[] {
  const featureNames = loadFeatureNames();
  const qaFiles: QAFile[] = [];

  if (!fs.existsSync(PACKAGES_DIR)) return qaFiles;

  const packageDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const pkgDir of packageDirs) {
    const manifestPath = path.join(PACKAGES_DIR, pkgDir, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));
    const qaDir = path.join(PACKAGES_DIR, pkgDir, "qa");
    if (!fs.existsSync(qaDir)) continue;

    const qaEntries = fs.readdirSync(qaDir).filter((f) => f.endsWith(".md"));

    for (const qaFile of qaEntries) {
      const featureId = qaFile.replace(".md", "");
      const content = fs.readFileSync(path.join(qaDir, qaFile), "utf-8");

      qaFiles.push({
        integrationSlug: manifest.slug,
        integrationName: manifest.name,
        featureId,
        featureName: featureNames.get(featureId) || featureId,
        content,
        filePath: path.join(qaDir, qaFile),
      });
    }
  }

  return qaFiles;
}

async function syncToNotion(qaFiles: QAFile[]): Promise<void> {
  // Group by integration
  const byIntegration = new Map<string, { name: string; files: QAFile[] }>();
  for (const file of qaFiles) {
    if (!byIntegration.has(file.integrationSlug)) {
      byIntegration.set(file.integrationSlug, {
        name: file.integrationName,
        files: [],
      });
    }
    byIntegration.get(file.integrationSlug)!.files.push(file);
  }

  console.log(
    `Syncing ${qaFiles.length} QA docs across ${byIntegration.size} integrations\n`,
  );

  for (const [slug, { name, files }] of byIntegration) {
    console.log(`  ${name} (${slug}): ${files.length} QA docs`);

    if (DRY_RUN) {
      for (const file of files) {
        console.log(`    - ${file.featureName} (${file.featureId})`);
      }
      continue;
    }

    // Find or create integration page
    let integrationPageId = await findChildPage(QA_PARENT_PAGE_ID, name);
    if (!integrationPageId) {
      console.log(`    Creating integration page: ${name}`);
      integrationPageId = await createPage(QA_PARENT_PAGE_ID, name, "📦");
    }

    // Sync each feature QA doc
    for (const file of files) {
      const pageTitle = `QA: ${file.featureName}`;
      let featurePageId = await findChildPage(integrationPageId, pageTitle);

      if (!featurePageId) {
        console.log(`    Creating: ${pageTitle}`);
        featurePageId = await createPage(integrationPageId, pageTitle, "✅");
      } else {
        console.log(`    Updating: ${pageTitle}`);
      }

      // Convert markdown to Notion blocks and replace content
      const blocks = markdownToNotionBlocks(file.content);

      // Add source file reference at the bottom
      blocks.push(
        { type: "divider", divider: {} },
        {
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                text: { content: "Source: " },
                annotations: { italic: true, color: "gray" },
              },
              {
                text: {
                  content: `showcase/integrations/${file.integrationSlug}/qa/${file.featureId}.md`,
                  link: {
                    url: `https://github.com/CopilotKit/CopilotKit/blob/main/showcase/integrations/${file.integrationSlug}/qa/${file.featureId}.md`,
                  },
                },
                annotations: { italic: true, color: "gray", code: true },
              },
            ],
          },
        },
        {
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                text: {
                  content: `Last synced: ${new Date().toISOString()}`,
                },
                annotations: { italic: true, color: "gray" },
              },
            ],
          },
        },
      );

      await replacePageContent(featurePageId, blocks);
    }
  }

  // Update the parent page's "last synced" timestamp
  if (!DRY_RUN) {
    const parentBlocks = await notionRequest(
      `/blocks/${QA_PARENT_PAGE_ID}/children?page_size=100`,
    );
    for (const block of parentBlocks.results) {
      if (
        block.type === "paragraph" &&
        block.paragraph?.rich_text?.[0]?.text?.content?.startsWith(
          "Last synced:",
        )
      ) {
        await notionRequest(`/blocks/${block.id}`, "PATCH", {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: `Last synced: ${new Date().toISOString()}`,
                },
                annotations: { italic: true },
              },
            ],
          },
        });
        break;
      }
    }
  }
}

async function main() {
  if (!NOTION_API_KEY) {
    console.error("Error: NOTION_API_KEY environment variable is required.");
    console.error(
      "Create a Notion integration at https://www.notion.so/my-integrations",
    );
    console.error("and share the QA parent page with it.");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("DRY RUN mode — no changes will be made to Notion\n");
  }

  const qaFiles = collectQAFiles();

  if (qaFiles.length === 0) {
    console.log("No QA files found in any integration packages.");
    return;
  }

  console.log(`Found ${qaFiles.length} QA files:\n`);

  try {
    await syncToNotion(qaFiles);
    console.log("\nSync complete.");
  } catch (error) {
    console.error("\nSync failed:", error);
    process.exit(1);
  }
}

main();
