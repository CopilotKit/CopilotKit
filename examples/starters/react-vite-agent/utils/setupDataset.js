import { downloadKaggleDataset } from './kaggleDownloader.js';
import { findCSVFiles, loadDataset } from './datasetLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yauzl from 'yauzl';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_OWNER = 'atharvasoundankar';
const DATASET_NAME = 'global-cybersecurity-threats-2015-2024';
const DATA_DIR = './data';

/**
 * Setup and load the cybersecurity threats dataset
 * Downloads if not present, then loads into memory
 */
export async function setupDataset() {
  const dataDir = path.resolve(__dirname, '..', DATA_DIR);
  const datasetDir = path.join(dataDir, DATASET_NAME);
  
  // Check if dataset already exists
  const csvFiles = await findCSVFiles(DATA_DIR);
  
  if (csvFiles.length === 0) {
    console.log('📥 Dataset not found. Downloading from Kaggle...');
    
    try {
      // Download the dataset
      const zipPath = await downloadKaggleDataset(DATASET_OWNER, DATASET_NAME, DATA_DIR);
      
      // Extract the zip file
      console.log('📦 Extracting dataset...');
      const extractPath = path.join(dataDir, DATASET_NAME);
      
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true });
      }
      
      // Extract zip file using yauzl
      await new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) {
            reject(err);
            return;
          }
          
          zipfile.readEntry();
          
          zipfile.on('entry', (entry) => {
            if (/\/$/.test(entry.fileName)) {
              // Directory entry
              const dirPath = path.join(extractPath, entry.fileName);
              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }
              zipfile.readEntry();
            } else {
              // File entry
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) {
                  reject(err);
                  return;
                }
                
                const filePath = path.join(extractPath, entry.fileName);
                const dirPath = path.dirname(filePath);
                if (!fs.existsSync(dirPath)) {
                  fs.mkdirSync(dirPath, { recursive: true });
                }
                
                const writeStream = fs.createWriteStream(filePath);
                readStream.pipe(writeStream);
                
                writeStream.on('close', () => {
                  zipfile.readEntry();
                });
              });
            }
          });
          
          zipfile.on('end', () => {
            console.log('✅ Dataset extracted successfully');
            // Clean up zip file
            fs.unlinkSync(zipPath);
            resolve();
          });
          
          zipfile.on('error', reject);
        });
      });
      
      // Find CSV files in extracted directory
      const extractedFiles = await findCSVFiles(path.join(DATA_DIR, DATASET_NAME));
      
      if (extractedFiles.length === 0) {
        throw new Error('No CSV files found in downloaded dataset');
      }
      
      console.log(`📊 Found ${extractedFiles.length} CSV file(s)`);
      return extractedFiles[0]; // Return first CSV file
    } catch (error) {
      console.error('❌ Error downloading dataset:', error.message);
      throw error;
    }
  } else {
    console.log(`✅ Found existing dataset: ${csvFiles[0]}`);
    return csvFiles[0];
  }
}

/**
 * Initialize the dataset (download if needed, then load)
 */
export async function initializeDataset() {
  try {
    const csvPath = await setupDataset();
    const data = await loadDataset(csvPath);
    console.log(`✅ Dataset initialized with ${data.length} records`);
    return csvPath;
  } catch (error) {
    console.error('❌ Failed to initialize dataset:', error);
    throw error;
  }
}
