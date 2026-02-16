#!/usr/bin/env node

/**
 * Script to verify broken links by pinging localhost:3001
 * Reads broken-links CSV, tests each URL, updates "Fixed?" column
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const CSV_FILE = "broken-links.csv";
const BASE_URL = "http://localhost:3001";

/**
 * Parse CSV file
 */
function parseCSV(content) {
  const lines = content.split("\n");
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((line) => {
    // Handle CSV with quoted fields
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current); // Add last field

    return fields;
  });

  return { headers, rows };
}

/**
 * Convert parsed data back to CSV
 */
function toCSV(headers, rows) {
  const headerLine = headers.join(",");
  const dataLines = rows.map((row) => row.join(","));
  return [headerLine, ...dataLines].join("\n");
}

/**
 * Check if a URL returns 404 or shows Next.js 404 page
 */
function checkURL(url) {
  return new Promise((resolve) => {
    const fullUrl = `${BASE_URL}${url}`;

    http
      .get(fullUrl, (res) => {
        // If actual HTTP 404, definitely broken
        if (res.statusCode === 404) {
          resolve(true);
          return;
        }

        // Next.js often returns 200 for custom 404 pages
        // So we need to check the content
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          // Check for common 404 page indicators
          const is404Page =
            data.includes("Page Not Found") ||
            (data.includes("404") && data.includes("couldn't find the page")) ||
            data.includes('"statusCode":404') ||
            data.includes('class="error-404"') ||
            data.includes('id="__next-error__"') ||
            data.includes('name="next-error" content="not-found"') ||
            data.includes("NEXT_HTTP_ERROR_FALLBACK;404");

          resolve(is404Page);
        });
      })
      .on("error", (err) => {
        console.error(`Error checking ${url}:`, err.message);
        resolve(null); // null means error occurred
      });
  });
}

/**
 * Main function
 */
async function main() {
  console.log("🔍 Verifying broken links...\n");

  // Read CSV file
  const csvPath = path.join(process.cwd(), CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Error: ${CSV_FILE} not found`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8");
  const { headers, rows } = parseCSV(content);

  console.log(`📄 Found ${rows.length} broken link entries\n`);

  // Check each URL
  let checked = 0;
  let stillBroken = 0;
  let fixed = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 4) continue; // Skip invalid rows

    const brokenUrl = row[3]; // Column 4 (0-indexed = 3)
    if (!brokenUrl || brokenUrl === "broken_url") continue; // Skip header or empty

    process.stdout.write(`[${i + 1}/${rows.length}] Checking ${brokenUrl}... `);

    const is404 = await checkURL(brokenUrl);

    if (is404 === null) {
      console.log("❌ ERROR");
      errors++;
      // Don't update the "Fixed?" column on error
    } else if (is404) {
      console.log("❌ Still broken (404)");
      row[0] = "no"; // Update "Fixed?" column
      stillBroken++;
    } else {
      console.log("✅ Fixed (not 404)");
      row[0] = "yes"; // Update "Fixed?" column
      fixed++;
    }

    checked++;
  }

  // Write updated CSV
  const updatedCSV = toCSV(headers, rows);
  fs.writeFileSync(csvPath, updatedCSV, "utf8");

  console.log("\n📊 Summary:");
  console.log(`  Total checked: ${checked}`);
  console.log(`  Still broken (404): ${stillBroken}`);
  console.log(`  Fixed (not 404): ${fixed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`\n✅ Updated ${CSV_FILE}`);
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
}

module.exports = { checkURL, parseCSV, toCSV };
