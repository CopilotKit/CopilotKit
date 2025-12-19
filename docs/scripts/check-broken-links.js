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
    
    links.push({
      text: text.trim(),
      url: url.trim(),
      file: filePath,
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  return links;
}

/**
 * Check if a link is valid
 */
function isValidLink(url, allPages) {
  // Remove leading slash and normalize
  const normalizedUrl = url.startsWith('/') ? url.slice(1) : url;
  const slug = normalizedUrl.split('/').filter(Boolean);
  
  // Check if page exists
  return allPages.some(page => {
    const pageSlug = page.slugs.join('/');
    return pageSlug === normalizedUrl || pageSlug === slug.join('/');
  });
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
 * Get all available pages
 */
function getAllPages() {
  const pages = [];
  
  try {
    // Walk through the docs directory and find all .mdx files
    const files = findMdxFiles(DOCS_DIR);
    
    files.forEach(file => {
      const relativePath = path.relative(DOCS_DIR, file);
      const slug = relativePath.replace(/\.mdx$/, '').split('/');
      
      pages.push({
        slugs: slug,
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
    if (!isValidLink(link.url, allPages)) {
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

module.exports = { extractLinks, isValidLink, getAllPages };
