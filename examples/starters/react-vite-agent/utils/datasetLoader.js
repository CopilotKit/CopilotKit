import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let datasetCache = null;
let datasetPath = null;

/**
 * Load CSV dataset into memory
 * @param {string} csvPath - Path to the CSV file
 * @returns {Promise<Array>} Array of records
 */
export async function loadDataset(csvPath) {
  if (datasetCache && datasetPath === csvPath) {
    return datasetCache;
  }

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Dataset file not found: ${csvPath}`);
  }

  console.log(`📊 Loading dataset from: ${csvPath}`);
  const records = [];

  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => {
        records.push(data);
      })
      .on('end', () => {
        console.log(`✅ Loaded ${records.length} records from dataset`);
        datasetCache = records;
        datasetPath = csvPath;
        resolve(records);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Find CSV files in a directory
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Array of CSV file paths
 */
export async function findCSVFiles(dir) {
  const fullDir = path.resolve(__dirname, '..', dir);
  
  if (!fs.existsSync(fullDir)) {
    return [];
  }

  const files = fs.readdirSync(fullDir, { recursive: true });
  return files
    .filter(file => file.endsWith('.csv'))
    .map(file => path.join(fullDir, file));
}

/**
 * Query the dataset
 * @param {Object} filters - Filter criteria
 * @param {number} limit - Maximum number of results
 * @returns {Array} Filtered records
 */
export function queryDataset(filters = {}, limit = 10) {
  if (!datasetCache) {
    throw new Error('Dataset not loaded. Call loadDataset() first.');
  }

  let results = [...datasetCache];

  // Apply filters
  if (filters.year) {
    results = results.filter(record => {
      const recordYear = extractYear(record);
      return recordYear === parseInt(filters.year);
    });
  }

  if (filters.threatType) {
    results = results.filter(record => {
      const threatType = getThreatType(record);
      return threatType && threatType.toLowerCase().includes(filters.threatType.toLowerCase());
    });
  }

  if (filters.severity) {
    results = results.filter(record => {
      const severity = getSeverity(record);
      return severity && severity.toLowerCase() === filters.severity.toLowerCase();
    });
  }

  if (filters.country) {
    results = results.filter(record => {
      const country = getCountry(record);
      return country && country.toLowerCase().includes(filters.country.toLowerCase());
    });
  }

  // Limit results
  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

/**
 * Get dataset statistics
 * @returns {Object} Statistics about the dataset
 */
export function getDatasetStats() {
  if (!datasetCache) {
    throw new Error('Dataset not loaded. Call loadDataset() first.');
  }

  const totalRecords = datasetCache.length;
  const years = new Set();
  const threatTypes = new Set();
  const countries = new Set();

  datasetCache.forEach(record => {
    const year = extractYear(record);
    if (year) years.add(year);

    const threatType = getThreatType(record);
    if (threatType) threatTypes.add(threatType);

    const country = getCountry(record);
    if (country) countries.add(country);
  });

  return {
    totalRecords,
    yearRange: {
      min: Math.min(...Array.from(years)),
      max: Math.max(...Array.from(years)),
    },
    uniqueThreatTypes: threatTypes.size,
    uniqueCountries: countries.size,
    sampleRecord: datasetCache[0] || null,
  };
}

// Helper functions to extract data (adapt based on actual CSV structure)
function extractYear(record) {
  // Try common year field names
  const yearField = record.Year || record.year || record.Year || record.date?.split('-')[0];
  return yearField ? parseInt(yearField) : null;
}

function getThreatType(record) {
  return record['Threat Type'] || record.threat_type || record.Type || record.type || record.ThreatType;
}

function getSeverity(record) {
  return record.Severity || record.severity || record.Level || record.level;
}

function getCountry(record) {
  return record.Country || record.country || record.Location || record.location;
}

/**
 * Clear the dataset cache
 */
export function clearCache() {
  datasetCache = null;
  datasetPath = null;
}
