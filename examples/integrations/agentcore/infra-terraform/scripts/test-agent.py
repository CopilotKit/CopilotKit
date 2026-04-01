#!/usr/bin/env python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Test Agent - AgentCore Runtime CLI Tester (Terraform)

Tests the deployed agent using Terraform outputs. Authenticates via Cognito
and invokes the agent with streaming response display.

Prerequisites:
    - Terraform infrastructure deployed (terraform apply)
    - AgentCore Runtime created
    - Dependencies: pip install boto3 requests colorama

Usage:
    cd infra-terraform
    python scripts/test-agent.py [message]

Examples:
    python scripts/test-agent.py 'Hello'           # Test with message
    python scripts/test-agent.py                   # Uses default message
"""

import getpass
import json
import subprocess  # nosec B404
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import quote

import boto3
import requests
from colorama import Fore, Style, init

# Initialize colorama for cross-platform colored output
init()


def log_info(msg: str) -> None:
    """Print info message."""
    print(f"{Fore.BLUE}ℹ{Style.RESET_ALL} {msg}")


def log_success(msg: str) -> None:
    """Print success message."""
    print(f"{Fore.GREEN}✓{Style.RESET_ALL} {msg}")


def log_error(msg: str) -> None:
    """Print error message."""
    print(f"{Fore.RED}✗{Style.RESET_ALL} {msg}", file=sys.stderr)


def get_terraform_outputs() -> Dict[str, str]:
    """
    Get outputs from Terraform state.

    Returns:
        Dict with runtime_arn, cognito_user_pool_id, cognito_web_client_id, region
    """
    terraform_dir = Path(__file__).parent.parent

    try:
        # Get individual outputs
        result = subprocess.run(  # nosec B603, B607
            ["terraform", "output", "-json"],
            cwd=terraform_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        outputs = json.loads(result.stdout)

        return {
            "runtime_arn": outputs.get("runtime_arn", {}).get("value", ""),
            "cognito_user_pool_id": outputs.get("cognito_user_pool_id", {}).get(
                "value", ""
            ),
            "cognito_web_client_id": outputs.get("cognito_web_client_id", {}).get(
                "value", ""
            ),
            "region": outputs.get("deployment_summary", {})
            .get("value", {})
            .get("region", "us-east-1"),
        }
    except subprocess.CalledProcessError as e:
        log_error(f"Failed to get Terraform outputs: {e.stderr}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        log_error(f"Failed to parse Terraform outputs: {e}")
        sys.exit(1)


def authenticate_cognito(
    user_pool_id: str, client_id: str, username: str, password: str, region: str
) -> Tuple[str, str]:
    """
    Authenticate with Cognito and return ID token.

    Args:
        user_pool_id: Cognito User Pool ID
        client_id: Cognito Client ID
        username: User's email/username
        password: User's password
        region: AWS region

    Returns:
        Tuple of (id_token, access_token)
    """
    client = boto3.client("cognito-idp", region_name=region)

    try:
        response = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            ClientId=client_id,
            AuthParameters={
                "USERNAME": username,
                "PASSWORD": password,
            },
        )

        # Handle NEW_PASSWORD_REQUIRED challenge
        if response.get("ChallengeName") == "NEW_PASSWORD_REQUIRED":
            log_info("New password required for first-time login")
            new_password = getpass.getpass("Set New Password: ")

            response = client.respond_to_auth_challenge(
                ClientId=client_id,
                ChallengeName="NEW_PASSWORD_REQUIRED",
                ChallengeResponses={
                    "USERNAME": username,
                    "NEW_PASSWORD": new_password,
                },
                Session=response["Session"],
            )

        auth_result = response.get("AuthenticationResult", {})
        id_token = auth_result.get("IdToken")
        access_token = auth_result.get("AccessToken")

        if not id_token:
            log_error("Failed to get ID token from authentication response")
            sys.exit(1)

        return id_token, access_token

    except client.exceptions.NotAuthorizedException as e:
        log_error(f"Authentication failed: {e}")
        sys.exit(1)
    except client.exceptions.UserNotFoundException as e:
        log_error(f"User not found: {e}")
        sys.exit(1)
    except Exception as e:
        log_error(f"Authentication error: {e}")
        sys.exit(1)


def generate_session_id() -> str:
    """Generate a session ID (must be >= 33 characters)."""
    return f"test-session-{int(time.time())}-{uuid.uuid4().hex[:16]}"


def generate_trace_id() -> str:
    """Generate X-Amzn-Trace-Id header value."""
    timestamp_hex = format(int(time.time()), "x")
    return f"1-{timestamp_hex}-{uuid.uuid4().hex[:24]}"


def sanitize_user_id(email: str) -> str:
    """
    Sanitize user ID for Memory API (replace @ and . with allowed characters).

    Args:
        email: User's email address

    Returns:
        Sanitized user ID matching regex [a-zA-Z0-9][a-zA-Z0-9-_/]*
    """
    return email.replace("@", "-at-").replace(".", "-")


def invoke_agent(
    runtime_arn: str,
    region: str,
    id_token: str,
    prompt: str,
    session_id: str,
    user_id: str,
) -> None:
    """
    Invoke the agent and stream the response.

    Args:
        runtime_arn: AgentCore Runtime ARN
        region: AWS region
        id_token: Cognito ID token
        prompt: User's message
        session_id: Session ID for conversation
        user_id: Sanitized user ID
    """
    # Build URL
    endpoint = f"https://bedrock-agentcore.{region}.amazonaws.com"
    encoded_arn = quote(runtime_arn, safe="")
    url = f"{endpoint}/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"

    # Generate trace ID
    trace_id = generate_trace_id()

    # Headers
    headers = {
        "Authorization": f"Bearer {id_token}",
        "Content-Type": "application/json",
        "X-Amzn-Trace-Id": trace_id,
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
    }

    # Payload
    payload = {
        "prompt": prompt,
        "runtimeSessionId": session_id,
        "userId": user_id,
    }

    log_info(f"Invoking agent at: {url}")
    print()
    print(f"{Fore.GREEN}Agent Response:{Style.RESET_ALL}")
    print()

    try:
        # Stream the response
        response = requests.post(
            url, headers=headers, json=payload, stream=True, timeout=120
        )

        if response.status_code != 200:
            log_error(f"HTTP {response.status_code}: {response.text}")
            return

        # Process streaming response
        for line in response.iter_lines(decode_unicode=True):
            if line:
                # Parse SSE format
                if line.startswith("data: "):
                    data = line[6:]  # Remove "data: " prefix
                    try:
                        parsed = json.loads(data)
                        # Check if parsed is a dict (not a string)
                        if isinstance(parsed, dict):
                            # Extract text from contentBlockDelta events
                            if "event" in parsed:
                                event = parsed["event"]
                                if (
                                    isinstance(event, dict)
                                    and "contentBlockDelta" in event
                                ):
                                    delta = event["contentBlockDelta"].get("delta", {})
                                    if isinstance(delta, dict):
                                        text = delta.get("text", "")
                                        if text:
                                            print(text, end="", flush=True)
                            # Check for final message
                            if "message" in parsed:
                                message = parsed["message"]
                                if isinstance(message, dict):
                                    content = message.get("content", [])
                                    if isinstance(content, list):
                                        for block in content:
                                            if (
                                                isinstance(block, dict)
                                                and "text" in block
                                            ):
                                                # Don't print final message - we already streamed it
                                                pass
                    except json.JSONDecodeError:
                        # Not JSON, skip internal debug strings
                        pass

        print()

    except requests.exceptions.ConnectionError as e:
        log_error(f"Connection error: {e}")
    except requests.exceptions.Timeout:
        log_error("Request timed out")
    except Exception as e:
        log_error(f"Error: {e}")


def main():
    """Main entry point."""
    print()
    print(f"{Fore.BLUE}========================================{Style.RESET_ALL}")
    print(f"{Fore.BLUE}  Agent Test (Terraform - Python)      {Style.RESET_ALL}")
    print(f"{Fore.BLUE}========================================{Style.RESET_ALL}")
    print()

    # Get message from args or use default
    message = sys.argv[1] if len(sys.argv) > 1 else "Hello! What are you capable of?"

    # Get Terraform outputs
    log_info("Fetching configuration from Terraform outputs...")
    outputs = get_terraform_outputs()

    runtime_arn = outputs["runtime_arn"]
    if not runtime_arn:
        log_error("Could not find Runtime ARN in Terraform outputs")
        sys.exit(1)

    log_success(f"Runtime ARN: {runtime_arn}")
    log_success(f"Region: {outputs['region']}")

    # Get credentials
    print()
    log_info("Enter your Cognito credentials (admin user created during deployment)")
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ")

    # Authenticate
    log_info("Authenticating with Cognito...")
    id_token, _ = authenticate_cognito(
        user_pool_id=outputs["cognito_user_pool_id"],
        client_id=outputs["cognito_web_client_id"],
        username=email,
        password=password,
        region=outputs["region"],
    )
    log_success("Authentication successful!")

    # Generate session ID
    session_id = generate_session_id()

    # Sanitize user ID
    user_id = sanitize_user_id(email)

    # Invoke agent
    print()
    log_info("Sending message to agent...")
    print(f"{Fore.CYAN}You:{Style.RESET_ALL} {message}")
    print()

    start_time = time.time()
    invoke_agent(
        runtime_arn=runtime_arn,
        region=outputs["region"],
        id_token=id_token,
        prompt=message,
        session_id=session_id,
        user_id=user_id,
    )
    elapsed = time.time() - start_time

    print()
    print(f"{Fore.CYAN}[Completed in {elapsed:.2f}s]{Style.RESET_ALL}")
    print()
    print(f"{Fore.GREEN}========================================{Style.RESET_ALL}")
    print(f"{Fore.GREEN}  Agent Test Complete!                 {Style.RESET_ALL}")
    print(f"{Fore.GREEN}========================================{Style.RESET_ALL}")
    print()


if __name__ == "__main__":
    main()
