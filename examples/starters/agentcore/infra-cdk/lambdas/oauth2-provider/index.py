"""
Custom Resource Lambda for managing OAuth2 Credential Provider lifecycle.

This Lambda is invoked by CloudFormation during stack deployment to manage
an OAuth2 Credential Provider in Bedrock AgentCore Identity. It retrieves the Cognito
client secret from Secrets Manager at runtime to avoid logging sensitive data.

CloudFormation Events:
- Create: Creates OAuth2 provider with credentials from Secrets Manager
- Update: Updates OAuth2 provider properties (clientId, clientSecret, discoveryUrl)
- Delete: Deletes OAuth2 provider by name
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_client = boto3.client("bedrock-agentcore-control")
secrets_client = boto3.client("secretsmanager")


def handler(event: dict, context: dict) -> dict:
    """
    CloudFormation Custom Resource handler for OAuth2 Credential Provider.

    Args:
        event: CloudFormation event containing RequestType and ResourceProperties
        context: Lambda context object

    Returns:
        Response dict with PhysicalResourceId and optional Data attributes
    """
    request_type = event["RequestType"]
    props = event["ResourceProperties"]

    logger.info(f"Request type: {request_type}")
    logger.info(f"Provider name: {props['ProviderName']}")

    try:
        if request_type == "Create":
            return handle_create(props)
        elif request_type == "Delete":
            return handle_delete(event, props)
        elif request_type == "Update":
            return handle_update(event, props)
        else:
            raise ValueError(f"Unknown request type: {request_type}")

    except Exception as e:
        logger.error(f"Error handling {request_type}: {str(e)}", exc_info=True)
        raise


def handle_create(props: dict) -> dict:
    """
    Create OAuth2 Credential Provider.

    Args:
        props: ResourceProperties from CloudFormation event

    Returns:
        Response with PhysicalResourceId and provider ARN
    """
    # Retrieve client secret from Secrets Manager (not logged)
    secret_arn = props["ClientSecretArn"]
    logger.info(f"Retrieving secret from: {secret_arn}")

    secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
    client_secret = secret_response["SecretString"]

    # Create OAuth2 Credential Provider
    logger.info(f"Creating OAuth2 provider: {props['ProviderName']}")

    response = bedrock_client.create_oauth2_credential_provider(
        name=props["ProviderName"],
        credentialProviderVendor="CustomOauth2",
        oauth2ProviderConfigInput={
            "customOauth2ProviderConfig": {
                "clientId": props["ClientId"],
                "clientSecret": client_secret,
                "oauthDiscovery": {"discoveryUrl": props["DiscoveryUrl"]},
            }
        },
    )

    provider_arn = response["credentialProviderArn"]
    logger.info(f"Created provider with ARN: {provider_arn}")

    return {
        "PhysicalResourceId": props["ProviderName"],
        "Data": {"ProviderArn": provider_arn},
    }


def handle_update(event: dict, props: dict) -> dict:
    """
    Update OAuth2 Credential Provider.

    Args:
        event: CloudFormation event
        props: ResourceProperties from CloudFormation event

    Returns:
        Response with PhysicalResourceId and provider ARN
    """
    provider_name = event["PhysicalResourceId"]
    logger.info(f"Updating OAuth2 provider: {provider_name}")

    # Retrieve client secret from Secrets Manager
    secret_arn = props["ClientSecretArn"]
    logger.info(f"Retrieving secret from: {secret_arn}")

    secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
    client_secret = secret_response["SecretString"]

    # Update OAuth2 Credential Provider
    response = bedrock_client.update_oauth2_credential_provider(
        name=provider_name,
        credentialProviderVendor="CustomOauth2",
        oauth2ProviderConfigInput={
            "customOauth2ProviderConfig": {
                "clientId": props["ClientId"],
                "clientSecret": client_secret,
                "oauthDiscovery": {"discoveryUrl": props["DiscoveryUrl"]},
            }
        },
    )

    provider_arn = response["credentialProviderArn"]
    logger.info(f"Updated provider with ARN: {provider_arn}")

    return {
        "PhysicalResourceId": provider_name,
        "Data": {"ProviderArn": provider_arn},
    }


def handle_delete(event: dict, props: dict) -> dict:
    """
    Delete OAuth2 Credential Provider.

    Args:
        event: CloudFormation event
        props: ResourceProperties from CloudFormation event

    Returns:
        Response with PhysicalResourceId
    """
    provider_name = event["PhysicalResourceId"]
    logger.info(f"Deleting OAuth2 provider: {provider_name}")

    try:
        bedrock_client.delete_oauth2_credential_provider(name=provider_name)
        logger.info(f"Deleted provider: {provider_name}")
    except bedrock_client.exceptions.ResourceNotFoundException:
        logger.warning(f"Provider not found (already deleted): {provider_name}")
    except Exception as e:
        logger.error(f"Error deleting provider: {str(e)}")
        raise

    return {"PhysicalResourceId": provider_name}
