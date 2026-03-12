import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import OpenAI from 'openai';

// Load environment variables from .env
dotenv.config();

const app = express();

// Enable CORS so the Vite dev server (port 5173) can reach this server (port 4000)
app.use(cors());
app.use(express.json());

// Validate that the OpenAI API key is set
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in your .env file');
  process.exit(1);
}

// Initialize OpenAI client and CopilotKit adapter
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const serviceAdapter = new OpenAIAdapter({ openai });
const runtime = new CopilotRuntime();

// Create the CopilotKit endpoint handler
const handler = copilotRuntimeNodeHttpEndpoint({
  endpoint: '/copilotkit',
  runtime,
  serviceAdapter,
});

// Mount the handler — Express strips the /copilotkit prefix,
// so we restore req.url before passing to the handler
app.use('/copilotkit', async (req, res, next) => {
  try {
    const expressModifiedUrl = req.url;
    if (req.path === '/copilotkit' || req.path === '/') {
      req.url = '/copilotkit';
    } else {
      req.url = req.originalUrl || req.url;
    }

    await handler(req, res);
    req.url = expressModifiedUrl;
  } catch (error) {
    console.error('CopilotKit handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      next(error);
    }
  }
});

app.listen(4000, () => {
  console.log('CopilotKit runtime server running on http://localhost:4000');
  console.log('Endpoint: http://localhost:4000/copilotkit');
});
