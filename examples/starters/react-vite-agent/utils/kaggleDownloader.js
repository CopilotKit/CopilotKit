import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { createUnzip } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Note: These are read at module load time, so dotenv.config() must be called before importing this module
// Or we can read them directly in the function
const getKaggleCredentials = () => {
  return {
    username: process.env.KAGGLE_USERNAME,
    key: process.env.KAGGLE_KEY,
  };
};

/**
 * Download a Kaggle dataset
 * @param {string} owner - Dataset owner (username)
 * @param {string} dataset - Dataset slug/name
 * @param {string} outputDir - Directory to save the dataset
 * @returns {Promise<string>} Path to the downloaded dataset
 */
export async function downloadKaggleDataset(owner, dataset, outputDir = './data') {
  const { username: KAGGLE_USERNAME, key: KAGGLE_KEY } = getKaggleCredentials();
  
  if (!KAGGLE_USERNAME || !KAGGLE_KEY) {
    throw new Error('KAGGLE_USERNAME and KAGGLE_KEY must be set in environment variables');
  }

  // Create output directory if it doesn't exist
  const dataDir = path.resolve(__dirname, '..', outputDir);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const url = `https://www.kaggle.com/api/v1/datasets/download/${owner}/${dataset}`;
  
  console.log(`📥 Downloading dataset from: ${url}`);
  
  try {
    const response = await axios({
      method: 'get',
      url,
      auth: {
        username: KAGGLE_USERNAME,
        password: KAGGLE_KEY,
      },
      responseType: 'stream',
    });

    const zipPath = path.join(dataDir, `${dataset}.zip`);
    const writer = createWriteStream(zipPath);

    await pipeline(response.data, writer);
    
    console.log(`✅ Dataset downloaded to: ${zipPath}`);
    return zipPath;
  } catch (error) {
    if (error.response) {
      throw new Error(`Kaggle API error: ${error.response.status} - ${error.response.statusText}`);
    }
    throw error;
  }
}

/**
 * Get dataset file list (requires Kaggle API metadata endpoint)
 * For now, we'll try common file names
 */
export function getDatasetFiles(datasetName) {
  // Common CSV file names for cybersecurity datasets
  const commonFiles = [
    'cybersecurity_threats.csv',
    'global_cybersecurity_threats.csv',
    'threats.csv',
    'data.csv',
    'cybersecurity_data.csv',
  ];
  
  return commonFiles.map(file => path.join('./data', datasetName, file));
}
