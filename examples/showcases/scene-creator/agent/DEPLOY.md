# Deploying the Agent to Railway

This guide covers deploying the LangGraph agent to Railway.

## Prerequisites

- [Railway account](https://railway.app/) (free tier available)
- Railway CLI (optional but recommended): `npm install -g @railway/cli`
- Google AI API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Method 1: Deploy via Railway CLI (Recommended)

1. **Install Railway CLI** (if not already installed):
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**:
   ```bash
   railway login
   ```

3. **Initialize Railway project** (from the agent directory):
   ```bash
   cd agent
   railway init
   ```

4. **Set environment variables**:
   ```bash
   railway variables set GOOGLE_API_KEY=your-google-ai-api-key-here
   ```

5. **Deploy**:
   ```bash
   railway up
   ```

6. **Get the deployment URL**:
   ```bash
   railway domain
   ```

## Method 2: Deploy via Railway Dashboard

1. **Go to [Railway Dashboard](https://railway.app/dashboard)**

2. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub account if not already connected
   - Select this repository

3. **Configure the service**:
   - Railway will auto-detect the Dockerfile
   - Root directory: `/agent`
   - Port: 8000 (automatically detected)

4. **Set Environment Variables**:
   - Go to the "Variables" tab
   - Add: `GOOGLE_API_KEY` = your Google AI API key
   - (Optional) Add LangSmith variables for tracing

5. **Deploy**:
   - Railway will automatically build and deploy
   - Wait for the build to complete (usually 2-3 minutes)

6. **Get the URL**:
   - Go to "Settings" > "Networking"
   - Click "Generate Domain"
   - Your agent will be available at: `https://your-project.up.railway.app`

## Method 3: Deploy via Railway Button

Add this to your repository README:

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)
```

## Updating the Frontend

After deploying the agent, update your Next.js frontend to use the Railway URL:

1. Open `src/app/api/copilotkit/route.ts`
2. Update the agent URL:
   ```typescript
   const agent = new LangGraphAgent({
     agentUrl: process.env.AGENT_URL || "https://your-project.up.railway.app",
   });
   ```

3. Add to your `.env.local`:
   ```
   AGENT_URL=https://your-project.up.railway.app
   ```

## Health Check

Once deployed, verify the agent is running:

```bash
curl https://your-project.up.railway.app/health
```

## Monitoring

- View logs: `railway logs`
- View metrics: Railway Dashboard > Metrics tab
- Add LangSmith for tracing: Set `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY`

## Troubleshooting

### Build fails with "No space left on device"
- Railway free tier has limited build space
- Try removing unused dependencies from requirements.txt

### Agent timeout errors
- Railway free tier has request timeouts
- For production, upgrade to Railway Pro

### Environment variables not working
- Ensure variables are set in Railway dashboard or via CLI
- Restart the deployment after adding variables

## Cost Optimization

Railway pricing:
- Free tier: $5 credit/month
- Pro: $20/month + usage-based pricing
- Image generation with Gemini uses Google AI quota, not Railway resources

For production deployment, consider:
- Monitoring image generation usage
- Implementing rate limiting
- Caching generated images
