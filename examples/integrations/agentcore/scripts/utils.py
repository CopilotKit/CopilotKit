#!/usr/bin/env python3
"""
Shared utilities for test scripts

Provides essential functions for stack discovery, AWS resource fetching, and authentication.
"""

import base64
import json
import sys
import uuid
from pathlib import Path
from typing import Dict, Optional, Tuple

import boto3
import yaml
from botocore.exceptions import ClientError
from colorama import Fore, Style, init

init(autoreset=True)


def get_stack_config(stack_name: Optional[str] = None) -> Dict:
    """
    Get complete stack configuration including outputs from main stack.

    Args:
        stack_name: Base stack name (if None, loads from config.yaml)

    Returns:
        Dictionary with stack_name, region, account, pattern, and outputs from main stack
    """
    # Load config.yaml
    script_dir = Path(__file__).parent
    config_path = script_dir.parent / "infra-cdk" / "config.yaml"

    if not config_path.exists():
        print_msg("Configuration file not found", "error")
        sys.exit(1)

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    # Get stack name from config if not provided
    if not stack_name:
        stack_name = config.get("stack_name_base")
        if not stack_name:
            print_msg("'stack_name_base' not found in config.yaml", "error")
            sys.exit(1)

    # Get pattern from config
    pattern = config.get("backend", {}).get("pattern", "strands-single-agent")

    cfn = boto3.client("cloudformation")

    try:
        # Get outputs from main stack (contains Cognito, Runtime ARN, etc.)
        response = cfn.describe_stacks(StackName=stack_name)
        stack_info = response["Stacks"][0]

        outputs = {}
        for output in stack_info.get("Outputs", []):
            outputs[output["OutputKey"]] = output["OutputValue"]

        # Extract region and account from stack ARN or any ARN in outputs
        stack_arn = stack_info["StackId"]
        region = stack_arn.split(":")[3]
        account = stack_arn.split(":")[4]

        return {
            "stack_name": stack_name,
            "region": region,
            "account": account,
            "pattern": pattern,
            "outputs": outputs,
        }

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        print_msg(f"CloudFormation error: {error_code}", "error")
        if error_code == "ValidationError":
            print_msg(
                f"Stack '{stack_name}' not found. Make sure you've deployed the CDK stack.",
                "error",
            )
        sys.exit(1)
    except Exception as e:
        print_msg(f"Failed to get stack config: {e}", "error")
        sys.exit(1)


def get_ssm_params(stack_name: str, *param_names: str) -> Dict[str, str]:
    """
    Fetch multiple SSM parameters for a stack.

    Args:
        stack_name: Base stack name
        *param_names: Parameter names (without the /{stack_name}/ prefix)

    Returns:
        Dictionary mapping parameter names to values
    """
    ssm = boto3.client("ssm")
    results = {}

    try:
        for param_name in param_names:
            full_name = f"/{stack_name}/{param_name}"
            response = ssm.get_parameter(Name=full_name)
            results[param_name] = response["Parameter"]["Value"]

        return results

    except Exception as e:
        print_msg(f"Failed to fetch SSM parameters: {e}", "error")
        sys.exit(1)


def authenticate_cognito(
    user_pool_id: str, client_id: str, username: str, password: str
) -> Tuple[str, str, str]:
    """
    Authenticate with Cognito.

    Args:
        user_pool_id: Cognito User Pool ID
        client_id: Cognito Client ID
        username: Username
        password: Password

    Returns:
        Tuple of (access_token, id_token, user_id)
        - access_token: For AgentCore runtime invocations (JWT authorizer)
        - id_token: For API Gateway Cognito User Pool authorizers
        - user_id: User's unique identifier (sub claim)
    """
    print("\nAuthenticating...")

    cognito = boto3.client("cognito-idp")

    try:
        # Check if user exists
        try:
            cognito.admin_get_user(UserPoolId=user_pool_id, Username=username)
        except cognito.exceptions.UserNotFoundException:
            print_msg(f"User '{username}' does not exist", "error")
            sys.exit(1)

        # Authenticate
        response = cognito.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            ClientId=client_id,
            AuthParameters={"USERNAME": username, "PASSWORD": password},
        )

        access_token = response["AuthenticationResult"]["AccessToken"]
        id_token = response["AuthenticationResult"]["IdToken"]

        # Decode ID token to get user ID
        import base64
        import json

        payload = id_token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = base64.b64decode(payload)
        token_data = json.loads(decoded)
        user_id = token_data.get("sub")

        print_msg("Authentication successful")
        print(f"  User ID: {user_id}")

        return access_token, id_token, user_id

    except Exception as e:
        print_msg(f"Authentication failed: {e}", "error")
        sys.exit(1)


def create_bedrock_client(region: str) -> boto3.client:
    """Create bedrock-agentcore client."""
    return boto3.client("bedrock-agentcore", region_name=region)


def generate_session_id() -> str:
    """Generate UUID4 session ID."""
    return str(uuid.uuid4())


def print_msg(message: str, level: str = "info") -> None:
    """
    Print formatted message.

    Args:
        message: Message to print
        level: 'success', 'error', 'info', or 'section'
    """
    if level == "success":
        print(f"{Fore.GREEN}✓ {message}{Style.RESET_ALL}")
    elif level == "error":
        print(f"{Fore.RED}✗ {message}{Style.RESET_ALL}")
    elif level == "info":
        print(f"{Fore.YELLOW}ℹ {message}{Style.RESET_ALL}")
    elif level == "section":
        print("\n" + "=" * 60)
        print(message)
        print("=" * 60 + "\n")


def print_section(title: str, width: int = 60) -> None:
    """Print section header."""
    print("\n" + "=" * width)
    print(title)
    print("=" * width + "\n")


def create_mock_jwt(user_id: str) -> str:
    """
    Create a mock unsigned JWT token with the given user_id as the 'sub' claim.

    The agent's extract_user_id_from_context() decodes the JWT without signature
    verification (since AgentCore Runtime validates it in production). This allows
    local testing to pass a user identity the same way production does.

    Args:
        user_id (str): The user ID to embed as the 'sub' claim.

    Returns:
        str: A mock JWT string (header.payload.signature).
    """
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(json.dumps({"sub": user_id}).encode())
        .rstrip(b"=")
        .decode()
    )
    return f"{header}.{payload}."
