#!/bin/bash
set -e

# Azure Container Apps Deployment Script for Kanban Demo
# This script deploys both the C# backend agent and Next.js frontend to Azure

echo "=================================================="
echo "Azure Container Apps Deployment - Kanban Demo"
echo "=================================================="
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI is not installed."
    echo "Please install it from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    echo "Error: Not logged into Azure."
    echo "Please run: az login"
    exit 1
fi

echo "Azure CLI detected and authenticated."
echo ""

# Prompt for configuration or use defaults
read -p "Resource Group name [kanban-demo-rg]: " RESOURCE_GROUP
RESOURCE_GROUP=${RESOURCE_GROUP:-kanban-demo-rg}

read -p "Location [eastus]: " LOCATION
LOCATION=${LOCATION:-eastus}

read -p "Azure Container Registry name [kanbandemoacr]: " ACR_NAME
ACR_NAME=${ACR_NAME:-kanbandemoacr}

read -p "Backend Container App name [kanban-agent]: " BACKEND_APP_NAME
BACKEND_APP_NAME=${BACKEND_APP_NAME:-kanban-agent}

read -p "Frontend Container App name [kanban-ui]: " FRONTEND_APP_NAME
FRONTEND_APP_NAME=${FRONTEND_APP_NAME:-kanban-ui}

# GitHub token is required for backend
if [ -z "$GITHUB_TOKEN" ]; then
    read -sp "GitHub Personal Access Token (required for backend): " GITHUB_TOKEN
    echo ""
    if [ -z "$GITHUB_TOKEN" ]; then
        echo "Error: GitHub token is required for the backend agent."
        echo "Get a token from: https://github.com/settings/tokens"
        exit 1
    fi
fi

echo ""
echo "Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  ACR Name: $ACR_NAME"
echo "  Backend App: $BACKEND_APP_NAME"
echo "  Frontend App: $FRONTEND_APP_NAME"
echo ""

read -p "Continue with deployment? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "Step 1: Creating resource group..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output table

echo ""
echo "Step 2: Creating Azure Container Registry..."
az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Basic \
    --admin-enabled true \
    --location "$LOCATION" \
    --output table

echo ""
echo "Step 3: Logging into ACR..."
az acr login --name "$ACR_NAME"

echo ""
echo "Step 4: Building backend image for linux/amd64..."
cd agent
docker build --platform linux/amd64 -t "$ACR_NAME.azurecr.io/kanban-agent:latest" -f Dockerfile ..
cd ..

echo ""
echo "Step 5: Pushing backend image..."
docker push "$ACR_NAME.azurecr.io/kanban-agent:latest"

echo ""
echo "Step 6: Building frontend image for linux/amd64..."
docker build --platform linux/amd64 -t "$ACR_NAME.azurecr.io/kanban-ui:latest" -f Dockerfile .

echo ""
echo "Step 7: Pushing frontend image..."
docker push "$ACR_NAME.azurecr.io/kanban-ui:latest"

echo ""
echo "Step 8: Creating Container Apps environment..."
az containerapp env create \
    --name kanban-env \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output table

echo ""
echo "Step 9: Getting ACR credentials..."
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query passwords[0].value -o tsv)
ACR_SERVER="${ACR_NAME}.azurecr.io"

echo ""
echo "Step 10: Deploying backend container app..."
az containerapp create \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment kanban-env \
    --image "${ACR_SERVER}/kanban-agent:latest" \
    --target-port 8000 \
    --ingress external \
    --registry-server "$ACR_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --cpu 0.5 \
    --memory 1.0Gi \
    --min-replicas 1 \
    --max-replicas 1 \
    --secrets github-token="$GITHUB_TOKEN" \
    --env-vars GitHubToken=secretref:github-token \
    --output table

BACKEND_FQDN=$(az containerapp show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn \
    -o tsv)

BACKEND_URL="https://${BACKEND_FQDN}"

echo ""
echo "Backend deployed at: $BACKEND_URL"

echo ""
echo "Step 11: Deploying frontend container app..."
az containerapp create \
    --name "$FRONTEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment kanban-env \
    --image "${ACR_SERVER}/kanban-ui:latest" \
    --target-port 3000 \
    --ingress external \
    --registry-server "$ACR_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --cpu 0.5 \
    --memory 1.0Gi \
    --min-replicas 1 \
    --max-replicas 1 \
    --env-vars NEXT_PUBLIC_BACKEND_URL="$BACKEND_URL" \
    --output table

FRONTEND_FQDN=$(az containerapp show \
    --name "$FRONTEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn \
    -o tsv)

FRONTEND_URL="https://${FRONTEND_FQDN}"

echo ""
echo "=================================================="
echo "Deployment Complete!"
echo "=================================================="
echo ""
echo "Frontend URL: $FRONTEND_URL"
echo "Backend URL:  $BACKEND_URL"
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo ""
echo "To view logs:"
echo "  Backend: az containerapp logs show --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP --follow"
echo "  Frontend: az containerapp logs show --name $FRONTEND_APP_NAME --resource-group $RESOURCE_GROUP --follow"
echo ""
echo "To delete resources:"
echo "  az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
