/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { A2AClient } from '@a2a-js/sdk/client';
import { MessageSendParams, Part, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();
let client: A2AClient | null = null;

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

app.post('/a2a', (req, res) => {
  let originalBody = '';

  req.on('data', (chunk) => {
    originalBody += chunk.toString();
  });

  req.on('end', async () => {
    let sendParams: MessageSendParams;

    if (isJson(originalBody)) {
      console.log('[a2a-middleware] Received JSON UI event:', originalBody);

      const clientEvent = JSON.parse(originalBody);
      sendParams = {
        message: {
          messageId: uuidv4(),
          role: 'user',
          parts: [
            {
              kind: 'data',
              data: clientEvent,
              metadata: { 'mimeType': 'application/json+a2aui' },
            } as Part,
          ],
          kind: 'message',
        },
      };
    } else {
      console.log('[a2a-middleware] Received text query:', originalBody);
      sendParams = {
        message: {
          messageId: uuidv4(),
          role: 'user',
          parts: [{ kind: 'text', text: originalBody }],
          kind: 'message',
        },
      };
    }

    const client = await createOrGetClient();
    const response = await client.sendMessage(sendParams);

    res.set('Cache-Control', 'no-store');

    if ('error' in response) {
      console.error('Error:', response.error.message);
      res.status(500).json({ error: response.error.message });
      return;
    }

    const result = (response as SendMessageSuccessResponse).result as Task;
    res.json(result.kind === 'task' ? result.status.message?.parts || [] : []);
  });
});

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

async function fetchWithCustomHeader(url: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', 'https://a2ui.org/a2a-extension/a2ui/v0.8');
  const newInit = { ...init, headers };
  return fetch(url, newInit);
}

async function createOrGetClient() {
  // Create a client pointing to the agent's Agent Card URL.
  client ??= await A2AClient.fromCardUrl('http://localhost:10002/.well-known/agent-card.json', {
    fetchImpl: fetchWithCustomHeader,
  });

  return client;
}

function isJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch (err) {
    console.warn(err);
    return false;
  }
}

export const reqHandler = createNodeRequestHandler(app);
