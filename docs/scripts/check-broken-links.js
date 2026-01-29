#!/usr/bin/env node

/**
 * Script to check for broken internal links in the documentation
 * This helps identify broken links before they reach users
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DOCS_DIR = 'content/docs';
const EXCLUDE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/build/**'];

/**
 * Extract all markdown links from a file
 */
function extractLinks(filePath, content) {
  const links = [];

  // Match markdown links [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = markdownLinkRegex.exec(content)) !== null) {
    const [, text, url] = match;

    // Skip external links
    if (url.startsWith('http') || url.startsWith('mailto:') || url.startsWith('tel:')) {
      continue;
    }

    // Skip anchor links
    if (url.startsWith('#')) {
      continue;
    }

    // Remove anchors from internal links
    const cleanUrl = url.split('#')[0];
    if (!cleanUrl) continue; // Skip if it was only an anchor

    links.push({
      text: text.trim(),
      url: cleanUrl.trim(),
      file: filePath,
      line: content.substring(0, match.index).split('\n').length
    });
  }

  return links;
}

/**
 * Normalize file path to URL path
 * Handles Fumadocs routing conventions:
 * - Removes route groups like (root), (other)
 * - Removes /integrations/ prefix
 * - Converts index.mdx to parent folder
 */
function filePathToUrl(relativePath) {
  let parts = relativePath.replace(/\.mdx$/, '').split('/');

  // Remove route groups (folders wrapped in parentheses)
  parts = parts.filter(part => !part.match(/^\([^)]+\)$/));

  // Remove 'integrations' prefix if present
  if (parts[0] === 'integrations') {
    parts.shift();
  }

  // Handle index files - remove 'index' from the end
  if (parts[parts.length - 1] === 'index') {
    parts.pop();
  }

  // Join and ensure we have a clean path
  const url = parts.join('/');
  return url || '/'; // Root if empty
}

/**
 * Check if a link is valid
 */
function isValidLink(url, allPages, sourceFile = null) {
  // Handle absolute links (starting with /)
  if (url.startsWith('/')) {
    // Remove leading slash and normalize
    const normalizedUrl = url.slice(1);

    // Remove trailing slash
    const cleanUrl = normalizedUrl.replace(/\/$/, '');

    // Check if page exists
    return allPages.some(page => {
      const pageUrl = page.url.replace(/\/$/, '');
      return pageUrl === cleanUrl || pageUrl === normalizedUrl;
    });
  }

  // Handle relative links (anything not starting with /)
  // This includes: ./foo, ../foo, and just foo
  if (sourceFile) {
    // Get the directory of the source file relative to DOCS_DIR
    const relativePath = path.relative(DOCS_DIR, sourceFile);
    const sourceDir = path.dirname(relativePath);

    // Resolve the relative link
    const resolvedPath = path.join(sourceDir, url);
    // Normalize the path (removes ./ and ../)
    const normalizedPath = path.normalize(resolvedPath);

    // Convert to URL format (strip route groups, handle index files, etc.)
    const resolvedUrl = filePathToUrl(normalizedPath);

    // Check if this resolved path exists in allPages
    return allPages.some(page => {
      const pageUrl = page.url.replace(/\/$/, '');
      const checkUrl = resolvedUrl.replace(/\/$/, '');
      return pageUrl === checkUrl || pageUrl === resolvedUrl;
    });
  }

  // Fallback: no source file provided, can't resolve relative links
  return false;
}

/**
 * Recursively find all .mdx files in a directory
 */
function findMdxFiles(dir) {
  const files = [];

  try {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively search subdirectories
        files.push(...findMdxFiles(fullPath));
      } else if (item.endsWith('.mdx')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }

  return files;
}

/**
 * Get all available pages with their URL mappings
 */
function getAllPages() {
  const pages = [];

  try {
    // Walk through the docs directory and find all .mdx files
    const files = findMdxFiles(DOCS_DIR);

    files.forEach(file => {
      const relativePath = path.relative(DOCS_DIR, file);
      const url = filePathToUrl(relativePath);

      pages.push({
        url: url,
        file: file
      });
    });
  } catch (error) {
    console.error('Error reading pages:', error);
  }

  return pages;
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Checking for broken links...\n');

  const allPages = getAllPages();
  const allLinks = [];
  const brokenLinks = [];

  // Find all .mdx files
  const files = findMdxFiles(DOCS_DIR);

  console.log(`📁 Found ${files.length} documentation files`);
  console.log(`📄 Found ${allPages.length} pages\n`);

  // Extract links from all files
  files.forEach(file => {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const links = extractLinks(file, content);
      allLinks.push(...links);
    } catch (error) {
      console.error(`Error reading ${file}:`, error.message);
    }
  });

  console.log(`🔗 Found ${allLinks.length} internal links\n`);

  // Check each link
  allLinks.forEach(link => {
    if (!isValidLink(link.url, allPages, link.file)) {
      brokenLinks.push(link);
    }
  });

  // Report results
  if (brokenLinks.length === 0) {
    console.log('✅ No broken links found!');
  } else {
    console.log(`❌ Found ${brokenLinks.length} broken links:\n`);

    brokenLinks.forEach(link => {
      console.log(`  📄 ${link.file}:${link.line}`);
      console.log(`     Link: [${link.text}](${link.url})`);
      console.log('');
    });

    console.log('💡 Suggestions:');
    console.log('  - Check if the file exists');
    console.log('  - Verify the path is correct');
    console.log('  - Consider adding redirects in middleware.ts');
    console.log('  - Update the link to point to the correct page');
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractLinks, isValidLink, getAllPages, filePathToUrl };
