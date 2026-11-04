"""
SSM Parameter Store utilities for agent patterns.

Provides a single shared function for fetching parameters from AWS SSM
Parameter Store, used by agents to retrieve configuration values like
Gateway URLs that are set during deployment.
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)


def get_ssm_parameter(parameter_name: str) -> str:
    """
    Fetch a parameter value from AWS SSM Parameter Store.

    SSM Parameter Store is AWS's service for storing configuration values
    securely. This function retrieves values like Gateway URLs and other
    stack-specific configuration that are set during CDK deployment.

    Args:
        parameter_name (str): The full SSM parameter name/path
            (e.g. '/my-stack/gateway_url').

    Returns:
        str: The parameter value.

    Raises:
        ValueError: If the parameter is not found or cannot be retrieved.
    """
    region = os.environ.get(
        "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )
    ssm = boto3.client("ssm", region_name=region)
    try:
        response = ssm.get_parameter(Name=parameter_name)
        return response["Parameter"]["Value"]
    except ssm.exceptions.ParameterNotFound:
        raise ValueError(f"SSM parameter not found: {parameter_name}")
    except Exception as e:
        raise ValueError(f"Failed to retrieve SSM parameter {parameter_name}: {e}")
