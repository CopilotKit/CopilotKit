import { getTableOfContents } from "fumadocs-core/server";
import fs from 'fs';
import path from 'path';

/**
 * Extracts table of contents from snippet files referenced in page content
 * Handles nested imports and excludes frontmatter
 */
async function extractSnippetTOC(content: string, processed = new Set<string>()): Promise<any[]> {
  const toc: any[] = [];
  const importPattern = /import\s+\w+\s+from\s+["']@\/snippets\/([^"']+)\.mdx["']/g;
  
  for (const match of content.matchAll(importPattern)) {
    const snippetPath = path.join(process.cwd(), 'snippets', `${match[1]}.mdx`);
    
    if (processed.has(snippetPath)) continue;
    processed.add(snippetPath);
    
    try {
      const snippetContent = fs.readFileSync(snippetPath, 'utf-8');
      const contentOnly = snippetContent.replace(/^---\n[\s\S]*?\n---\n/, '');
      
      // Extract headers from this snippet
      const snippetTOC = await getTableOfContents(contentOnly);
      toc.push(...snippetTOC);
      
      // Process nested imports
      const nestedTOC = await extractSnippetTOC(snippetContent, processed);
      toc.push(...nestedTOC);
    } catch {
      // Silently skip missing files
    }
  }
  
  return toc;
}

/**
 * Gets snippet TOC for a specific page by reading its source file
 */
export async function getSnippetTOCForPage(slug?: string[]): Promise<any[]> {
  if (!slug) return [];
  
  const possiblePaths = [
    path.join(process.cwd(), 'content/docs', ...slug, 'index.mdx'),
    path.join(process.cwd(), 'content/docs', ...slug) + '.mdx',
  ];
  
  for (const filePath of possiblePaths) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return await extractSnippetTOC(content);
    } catch {
      continue;
    }
  }
  
  return [];
}