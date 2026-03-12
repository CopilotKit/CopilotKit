# Azure Container Apps Deployment Guide

This guide covers deploying the Kanban application (C# backend agent + Next.js frontend) to Azure Container Apps.

## Prerequisites

### 1. Azure CLI

Install the Azure CLI:
- **macOS**: `brew install azure-cli`
- **Windows**: Download from [Microsoft Docs](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli-windows)
- **Linux**: Follow instructions at [Microsoft Docs](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli-linux)

After installation, verify:
```bash
az --version
```

### 2. Azure Subscription

You need an active Azure subscription. Sign up for a free account at [azure.microsoft.com](https://azure.microsoft.com/free/).

### 3. GitHub Personal Access Token

The backend agent requires a GitHub token to access GitHub Models API.

**Get your token:**
```bash
# If you have GitHub CLI installed
gh auth token

# Or create manually:
# 1. Go to https://github.com/settings/tokens
# 2. Click "Generate new token (classic)"
# 3. Select scopes: repo (full control)
# 4. Generate and copy the token
```

**Set the token as an environment variable:**
```bash
export GITHUB_TOKEN="your_token_here"
```

### 4. Login to Azure

```bash
az login
```

This will open a browser window for authentication.

## Quick Deployment

### 1. Run the Deployment Script

From the project root:

```bash
./scripts/deploy-azure.sh
```

The script will:
1. Prompt for configuration (or use defaults)
2. Create Azure resource group
3. Create Azure Container Registry (ACR)
4. Build and push Docker images
5. Create Container Apps environment
6. Deploy backend container app
7. Deploy frontend container app
8. Output URLs for both applications

### 2. Access Your Application

After deployment completes, you'll see:
```
Frontend URL: https://kanban-ui.xxx.azurecontainerapps.io
Backend URL:  https://kanban-agent.xxx.azurecontainerapps.io
```

Open the frontend URL in your browser to use the Kanban board.

## Configuration Options

When running the deployment script, you can customize:

| Option | Default | Description |
|--------|---------|-------------|
| Resource Group | `kanban-demo-rg` | Azure resource group name |
| Location | `eastus` | Azure region |
| ACR Name | `kanbandemoacr` | Container registry name (must be globally unique) |
| Backend App | `kanban-agent` | Backend container app name |
| Frontend App | `kanban-ui` | Frontend container app name |

## Manual Deployment Steps

If you prefer to deploy manually or customize the process:

### 1. Create Resource Group

```bash
az group create \
  --name kanban-demo-rg \
  --location eastus
```

### 2. Create Container Registry

```bash
az acr create \
  --name kanbandemoacr \
  --resource-group kanban-demo-rg \
  --sku Basic \
  --admin-enabled true
```

### 3. Build and Push Images

**Backend:**
```bash
az acr build \
  --registry kanbandemoacr \
  --image kanban-agent:latest \
  --file agent/Dockerfile \
  --context .
```

**Frontend:**
```bash
az acr build \
  --registry kanbandemoacr \
  --image kanban-ui:latest \
  --file Dockerfile \
  --context .
```

### 4. Create Container Apps Environment

```bash
az containerapp env create \
  --name kanban-env \
  --resource-group kanban-demo-rg \
  --location eastus
```

### 5. Deploy Backend

Get ACR credentials:
```bash
ACR_USERNAME=$(az acr credential show --name kanbandemoacr --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name kanbandemoacr --query passwords[0].value -o tsv)
```

Deploy backend:
```bash
az containerapp create \
  --name kanban-agent \
  --resource-group kanban-demo-rg \
  --environment kanban-env \
  --image kanbandemoacr.azurecr.io/kanban-agent:latest \
  --target-port 8000 \
  --ingress external \
  --registry-server kanbandemoacr.azurecr.io \
  --registry-username "$ACR_USERNAME" \
  --registry-password "$ACR_PASSWORD" \
  --secrets github-token="$GITHUB_TOKEN" \
  --env-vars GitHubToken=secretref:github-token
```

Get backend URL:
```bash
BACKEND_URL=$(az containerapp show \
  --name kanban-agent \
  --resource-group kanban-demo-rg \
  --query properties.configuration.ingress.fqdn \
  -o tsv)
```

### 6. Deploy Frontend

```bash
az containerapp create \
  --name kanban-ui \
  --resource-group kanban-demo-rg \
  --environment kanban-env \
  --image kanbandemoacr.azurecr.io/kanban-ui:latest \
  --target-port 3000 \
  --ingress external \
  --registry-server kanbandemoacr.azurecr.io \
  --registry-username "$ACR_USERNAME" \
  --registry-password "$ACR_PASSWORD" \
  --env-vars NEXT_PUBLIC_BACKEND_URL="https://$BACKEND_URL"
```

## Updating Deployed Applications

### Update Backend

After making code changes:

```bash
# Rebuild and push
az acr build \
  --registry kanbandemoacr \
  --image kanban-agent:latest \
  --file agent/Dockerfile \
  --context .

# Update container app
az containerapp update \
  --name kanban-agent \
  --resource-group kanban-demo-rg \
  --image kanbandemoacr.azurecr.io/kanban-agent:latest
```

### Update Frontend

```bash
# Rebuild and push
az acr build \
  --registry kanbandemoacr \
  --image kanban-ui:latest \
  --file Dockerfile \
  --context .

# Update container app
az containerapp update \
  --name kanban-ui \
  --resource-group kanban-demo-rg \
  --image kanbandemoacr.azurecr.io/kanban-ui:latest
```

## Viewing Logs

### Backend Logs

```bash
az containerapp logs show \
  --name kanban-agent \
  --resource-group kanban-demo-rg \
  --follow
```

### Frontend Logs

```bash
az containerapp logs show \
  --name kanban-ui \
  --resource-group kanban-demo-rg \
  --follow
```

### Log Analytics

Access detailed logs via Azure Portal:
1. Navigate to your Container App
2. Click "Log stream" in the left menu
3. Or use "Logs" for advanced querying with KQL

## Scaling

Container Apps auto-scale based on HTTP traffic. To configure:

```bash
az containerapp update \
  --name kanban-ui \
  --resource-group kanban-demo-rg \
  --min-replicas 1 \
  --max-replicas 5
```

## Cost Estimation

Azure Container Apps pricing (as of 2024):

| Resource | Cost | Notes |
|----------|------|-------|
| Container Apps | **Free tier**: 180,000 vCPU-seconds/month | Should cover demo usage |
| Container Apps (beyond free) | ~$0.000012/vCPU-second | After free tier |
| Azure Container Registry (Basic) | ~$5/month | 10 GB storage included |
| **Estimated total** | **~$5-10/month** | For demo with minimal traffic |

### Cost Optimization Tips

1. **Delete when not in use**: Run `az group delete --name kanban-demo-rg` after demos
2. **Use free tier**: Keep replicas at 1 to stay within free limits
3. **Monitor usage**: Check Azure Cost Management dashboard

## Teardown

Delete all resources:

```bash
az group delete \
  --name kanban-demo-rg \
  --yes \
  --no-wait
```

This removes:
- Container Apps environment
- Both container apps (frontend + backend)
- Container registry
- All associated resources

**Note**: Deletion takes 5-10 minutes. Use `--no-wait` to run in background.

## Troubleshooting

### Issue: ACR name already exists

**Error**: `The registry DNS name 'kanbandemoacr' is already in use.`

**Solution**: ACR names must be globally unique. Try a different name:
```bash
ACR_NAME="kanbandemoacr$(date +%s)"
```

### Issue: Backend fails to start

**Check logs**:
```bash
az containerapp logs show --name kanban-agent --resource-group kanban-demo-rg --tail 50
```

**Common causes**:
- Missing or invalid GitHub token
- Port misconfiguration
- Dependencies not copied (check Dockerfile)

### Issue: Frontend can't connect to backend

**Verify backend URL**:
```bash
az containerapp show \
  --name kanban-agent \
  --resource-group kanban-demo-rg \
  --query properties.configuration.ingress.fqdn
```

**Update frontend**:
```bash
az containerapp update \
  --name kanban-ui \
  --resource-group kanban-demo-rg \
  --set-env-vars NEXT_PUBLIC_BACKEND_URL="https://<backend-fqdn>"
```

### Issue: Container build fails

**Check Docker locally**:
```bash
# Test backend build
docker build -t kanban-agent -f agent/Dockerfile .

# Test frontend build
docker build -t kanban-ui -f Dockerfile .
```

**Common causes**:
- Missing dependencies in package.json
- Incorrect COPY paths in Dockerfile
- .dockerignore excluding required files

### Issue: "az: command not found"

Install Azure CLI (see Prerequisites section).

### Issue: Authentication errors

Re-authenticate:
```bash
az logout
az login
```

## Additional Resources

- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Next.js Deployment Guide](https://nextjs.org/docs/app/building-your-application/deploying)
- [.NET Container Images](https://hub.docker.com/_/microsoft-dotnet)
- [GitHub Models API](https://github.com/marketplace/models)

## Security Considerations

### Secrets Management

- GitHub token is stored as a Container App secret (encrypted at rest)
- Never commit tokens to version control
- Rotate tokens regularly

### Network Security

- Both apps use HTTPS by default
- Consider using Azure Virtual Network for production
- Enable Azure AD authentication for production deployments

### Access Control

Restrict access to Azure resources:
```bash
az role assignment create \
  --assignee user@example.com \
  --role Contributor \
  --resource-group kanban-demo-rg
```

## Support

For issues specific to:
- **Azure Container Apps**: Check [Microsoft Docs](https://learn.microsoft.com/en-us/azure/container-apps/)
- **CopilotKit**: Visit [CopilotKit Docs](https://docs.copilotkit.ai/)
- **Microsoft Agent Framework**: See [GitHub Repository](https://github.com/microsoft/agent-framework)
