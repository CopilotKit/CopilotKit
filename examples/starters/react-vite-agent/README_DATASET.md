# Cybersecurity Threats Dataset Integration

This project integrates the [Global Cybersecurity Threats (2015-2024)](https://www.kaggle.com/datasets/atharvasoundankar/global-cybersecurity-threats-2015-2024/data) dataset from Kaggle.

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

This will install:
- `axios` - For downloading the dataset from Kaggle API
- `csv-parser` - For parsing CSV files

### 2. Get Kaggle API Credentials

1. Go to [Kaggle Account Settings](https://www.kaggle.com/settings)
2. Scroll to the "API" section
3. Click "Create New API Token"
4. Download the `kaggle.json` file

### 3. Set Environment Variables

Add to your `.env` file:

```env
KAGGLE_USERNAME=your_kaggle_username
KAGGLE_KEY=your_kaggle_api_key
```

You can find these values in the downloaded `kaggle.json` file:
```json
{
  "username": "your_kaggle_username",
  "key": "your_kaggle_api_key"
}
```

### 4. Run the Server

The dataset will be automatically downloaded and loaded when you start the server:

```bash
pnpm dev:server
```

Or run both frontend and backend:

```bash
pnpm dev:all
```

## Manual Dataset Setup (Alternative)

If you prefer to download the dataset manually:

1. Go to the [dataset page](https://www.kaggle.com/datasets/atharvasoundankar/global-cybersecurity-threats-2015-2024/data)
2. Click "Download" and extract the files
3. Place the CSV file(s) in the `./data/global-cybersecurity-threats-2015-2024/` directory
4. The server will automatically detect and load the CSV file(s)

## Available AI Tools

Once the dataset is loaded, the AI assistant can:

### 1. Query Cybersecurity Threats
- **Tool**: `queryCybersecurityThreats`
- **Capabilities**:
  - Filter by year (2015-2024)
  - Filter by threat type (malware, phishing, ransomware, DDoS, etc.)
  - Filter by severity (low, medium, high, critical)
  - Filter by country
  - Limit results (default: 10, max: 50)

**Example queries:**
- "Show me all critical threats from 2023"
- "What phishing threats occurred in the United States?"
- "List ransomware incidents from 2022"

### 2. Get Dataset Statistics
- **Tool**: `getCybersecurityStats`
- **Returns**:
  - Total number of records
  - Year range (min/max)
  - Number of unique threat types
  - Number of unique countries
  - Sample record structure

**Example queries:**
- "What's the overview of the cybersecurity dataset?"
- "How many records are in the dataset?"
- "What years does the dataset cover?"

## Dataset Structure

The dataset contains global cybersecurity threats from 2015-2024. The exact structure may vary, but common fields include:
- Year
- Threat Type
- Severity
- Country/Location
- Description
- Date

The query functions automatically adapt to the actual CSV structure.

## Troubleshooting

### Dataset Not Loading

1. **Check Kaggle credentials**: Ensure `KAGGLE_USERNAME` and `KAGGLE_KEY` are set in `.env`
2. **Check file location**: CSV files should be in `./data/global-cybersecurity-threats-2015-2024/`
3. **Check file format**: Ensure the file is a valid CSV
4. **Check server logs**: Look for error messages in the console

### "Dataset not loaded" Error

- The dataset may still be downloading
- Check that the CSV file exists in the data directory
- Verify the file is not corrupted
- Check server logs for specific error messages

### API Rate Limits

Kaggle API has rate limits. If you hit them:
- Wait a few minutes and try again
- Consider downloading the dataset manually

## Data Directory Structure

```
data/
└── global-cybersecurity-threats-2015-2024/
    └── [CSV files from the dataset]
```

The `data/` directory is gitignored to avoid committing large dataset files.
