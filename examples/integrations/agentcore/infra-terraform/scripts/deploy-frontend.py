#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Cross-platform frontend deployment script for Terraform deployments.

Deploys the Next.js frontend to AWS Amplify by:
1. Fetching configuration from Terraform outputs
2. Generating aws-exports.json
3. Building the frontend
4. Packaging and uploading to S3
5. Triggering Amplify deployment

Requires: Python 3.8+, AWS CLI, npm, Node.js, Terraform
No external Python dependencies - uses standard library only.

Usage:
    cd infra-terraform
    python scripts/deploy-frontend.py

    # Or with pattern override
    python scripts/deploy-frontend.py --pattern langgraph-single-agent
"""

import argparse
import atexit
import json
import os
import re
import shutil
import subprocess  # nosec B404 - subprocess used securely with explicit parameters
import sys
import time
from pathlib import Path
from typing import Dict, Optional

# Minimum Python version check
if sys.version_info < (3, 8):
    print("Error: Python 3.8 or higher is required")
    sys.exit(1)

# Constants
BRANCH_NAME = "main"
NEXT_BUILD_DIR = "build"
CLEANUP_FILES: list = []


# --- Logging helpers ---


def log_info(message: str) -> None:
    """Print an info message."""
    print(f"ℹ {message}")


def log_success(message: str) -> None:
    """Print a success message."""
    print(f"✓ {message}")


def log_error(message: str) -> None:
    """Print an error message to stderr."""
    print(f"✗ {message}", file=sys.stderr)


def log_warning(message: str) -> None:
    """Print a warning message."""
    print(f"⚠ {message}")


# --- Utility functions ---


def cleanup() -> None:
    """Remove temporary files created during deployment."""
    for filepath in CLEANUP_FILES:
        if os.path.exists(filepath):
            os.remove(filepath)
            log_info(f"Cleaned up {filepath}")


def run_command(
    command: list,
    capture_output: bool = True,
    check: bool = True,
    cwd: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """
    Execute a command securely via subprocess.

    Args:
        command: List of command arguments
        capture_output: Whether to capture stdout/stderr
        check: Whether to raise on non-zero exit
        cwd: Working directory for the command

    Returns:
        CompletedProcess instance with command results
    """
    return subprocess.run(  # nosec B603 - command constructed from safe list
        command,
        capture_output=capture_output,
        text=True,
        check=check,
        shell=False,
        timeout=300,
        cwd=cwd,
    )


def check_prerequisite(command: str) -> bool:
    """
    Check if a command is available in PATH.

    Args:
        command: Name of the command to check

    Returns:
        True if command exists, False otherwise
    """
    return shutil.which(command) is not None


def parse_tfvars(tfvars_path: Path) -> Dict[str, str]:
    """
    Parse terraform.tfvars using regex (no HCL parser dependency).

    Args:
        tfvars_path: Path to terraform.tfvars file

    Returns:
        Dictionary with parsed values
    """
    config = {"backend_pattern": "strands-single-agent"}

    if not tfvars_path.exists():
        return config

    content = tfvars_path.read_text()

    # Extract backend_pattern
    match = re.search(r'^backend_pattern\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if match:
        config["backend_pattern"] = match.group(1)

    return config


def get_file_size_human(filepath: str) -> str:
    """
    Get human-readable file size.

    Args:
        filepath: Path to the file

    Returns:
        Human-readable size string (e.g., "1.5MB")
    """
    size = os.path.getsize(filepath)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


# --- Terraform output functions ---


def get_terraform_outputs(terraform_dir: Path) -> Dict[str, str]:
    """
    Fetch Terraform outputs via terraform output command.

    Args:
        terraform_dir: Path to the Terraform directory

    Returns:
        Dictionary mapping output keys to values
    """
    result = run_command(["terraform", "output", "-json"], cwd=str(terraform_dir))

    raw_outputs = json.loads(result.stdout)

    # Flatten the Terraform output format (each value has a "value" key)
    outputs = {}
    for key, data in raw_outputs.items():
        if isinstance(data, dict) and "value" in data:
            outputs[key] = data["value"]
        else:
            outputs[key] = data

    return outputs


# --- AWS CLI wrappers ---


def upload_to_s3(local_path: str, bucket: str, key: str) -> None:
    """
    Upload a file to S3 via AWS CLI.

    Args:
        local_path: Path to local file
        bucket: S3 bucket name
        key: S3 object key
    """
    run_command(
        ["aws", "s3", "cp", local_path, f"s3://{bucket}/{key}", "--no-progress"]
    )


def start_amplify_deployment(app_id: str, branch: str, source_url: str) -> Dict:
    """
    Start an Amplify deployment via AWS CLI.

    Args:
        app_id: Amplify application ID
        branch: Branch name to deploy
        source_url: S3 URL of deployment package

    Returns:
        Deployment response as dictionary
    """
    result = run_command(
        [
            "aws",
            "amplify",
            "start-deployment",
            "--app-id",
            app_id,
            "--branch-name",
            branch,
            "--source-url",
            source_url,
            "--output",
            "json",
        ]
    )

    return json.loads(result.stdout)


def get_amplify_job_status(app_id: str, branch: str, job_id: str) -> str:
    """
    Get the status of an Amplify deployment job.

    Args:
        app_id: Amplify application ID
        branch: Branch name
        job_id: Deployment job ID

    Returns:
        Job status string
    """
    result = run_command(
        [
            "aws",
            "amplify",
            "get-job",
            "--app-id",
            app_id,
            "--branch-name",
            branch,
            "--job-id",
            job_id,
            "--output",
            "json",
        ]
    )

    return json.loads(result.stdout)["job"]["summary"]["status"]


def get_amplify_app_domain(app_id: str) -> str:
    """
    Get the default domain for an Amplify app.

    Args:
        app_id: Amplify application ID

    Returns:
        Default domain string
    """
    result = run_command(
        [
            "aws",
            "amplify",
            "get-app",
            "--app-id",
            app_id,
            "--query",
            "app.defaultDomain",
            "--output",
            "text",
        ]
    )

    return result.stdout.strip()


# --- Main deployment logic ---


def generate_aws_exports(
    outputs: Dict[str, str], pattern: str, frontend_dir: Path
) -> None:
    """
    Generate aws-exports.json configuration file.

    Args:
        outputs: Terraform outputs dictionary
        pattern: Agent pattern name
        frontend_dir: Path to frontend directory
    """
    # Map Terraform output names to required values
    required_mappings = {
        "cognito_web_client_id": "client_id",
        "cognito_user_pool_id": "user_pool_id",
        "amplify_app_url": "app_url",
        "runtime_arn": "runtime_arn",
        "feedback_api_url": "feedback_api_url",
        "copilotkit_runtime_url": "copilotkit_runtime_url",
    }

    missing = [k for k in required_mappings.keys() if k not in outputs]
    if missing:
        raise ValueError(f"Missing required Terraform outputs: {', '.join(missing)}")

    # Get region from deployment_summary or default
    region = "us-east-1"
    if "deployment_summary" in outputs and isinstance(
        outputs["deployment_summary"], dict
    ):
        region = outputs["deployment_summary"].get("region", region)

    aws_exports = {
        "authority": f"https://cognito-idp.{region}.amazonaws.com/{outputs['cognito_user_pool_id']}",
        "client_id": outputs["cognito_web_client_id"],
        "redirect_uri": outputs["amplify_app_url"],
        "post_logout_redirect_uri": outputs["amplify_app_url"],
        "response_type": "code",
        "scope": "email openid profile",
        "automaticSilentRenew": True,
        "agentRuntimeArn": outputs["runtime_arn"],
        "awsRegion": region,
        "feedbackApiUrl": outputs["feedback_api_url"],
        "copilotKitRuntimeUrl": outputs["copilotkit_runtime_url"],
        "agentPattern": pattern,
    }

    public_dir = frontend_dir / "public"
    public_dir.mkdir(parents=True, exist_ok=True)

    output_path = public_dir / "aws-exports.json"
    output_path.write_text(json.dumps(aws_exports, indent=2))

    log_success(f"Generated aws-exports.json at {output_path}")


def create_deployment_zip(build_dir: Path, output_path: Path) -> None:
    """
    Create a zip archive of the build directory.

    Args:
        build_dir: Path to the build directory
        output_path: Path for the output zip file (without .zip extension)
    """
    # shutil.make_archive adds .zip automatically
    shutil.make_archive(
        str(output_path.with_suffix("")), "zip", root_dir=str(build_dir)
    )


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Deploy frontend to AWS Amplify using Terraform outputs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/deploy-frontend.py
  python scripts/deploy-frontend.py --pattern langgraph-single-agent
        """,
    )

    parser.add_argument(
        "--pattern",
        "-p",
        type=str,
        help="Override agent pattern (default: from terraform.tfvars)",
    )

    return parser.parse_args()


def main() -> int:
    """
    Main deployment function.

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    atexit.register(cleanup)
    args = parse_args()

    # Determine paths
    script_dir = Path(__file__).parent.resolve()
    terraform_dir = script_dir.parent
    project_root = terraform_dir.parent
    frontend_dir = project_root / "frontend"
    tfvars_path = terraform_dir / "terraform.tfvars"

    print()
    print("========================================")
    print("  Frontend Deployment (Terraform)      ")
    print("========================================")
    print()

    log_info("🚀 Starting frontend deployment process...")
    print()

    # Validate prerequisites
    log_info("Validating prerequisites...")
    prerequisites = ["npm", "aws", "node", "terraform"]
    for prereq in prerequisites:
        if not check_prerequisite(prereq):
            log_error(f"{prereq} is not installed")
            return 1
    log_success("All prerequisites found")

    # Verify AWS credentials are configured
    log_info("Verifying AWS credentials...")
    try:
        run_command(["aws", "sts", "get-caller-identity"], capture_output=True)
        log_success("AWS credentials configured")
    except subprocess.CalledProcessError:
        log_error("AWS credentials not configured or invalid")
        log_info("Run 'aws configure' to set up your AWS credentials")
        return 1

    # Verify Terraform state exists
    if not (terraform_dir / "terraform.tfstate").exists():
        log_error("Terraform state not found. Run 'terraform apply' first.")
        return 1

    # Fetch Terraform outputs
    log_info("Fetching configuration from Terraform outputs...")
    try:
        outputs = get_terraform_outputs(terraform_dir)
    except subprocess.CalledProcessError as e:
        log_error(f"Failed to fetch Terraform outputs: {e.stderr}")
        return 1
    except json.JSONDecodeError as e:
        log_error(f"Failed to parse Terraform outputs: {e}")
        return 1

    # Validate required outputs
    app_id = outputs.get("amplify_app_id")
    deployment_bucket = outputs.get("amplify_staging_bucket")
    region = "us-east-1"

    if "deployment_summary" in outputs and isinstance(
        outputs["deployment_summary"], dict
    ):
        region = outputs["deployment_summary"].get("region", region)

    if not app_id:
        log_error("Could not find amplify_app_id in Terraform outputs")
        return 1
    if not deployment_bucket:
        log_error("Could not find amplify_staging_bucket in Terraform outputs")
        return 1

    log_success(f"App ID: {app_id}")
    log_success(f"Staging Bucket: {deployment_bucket}")
    log_success(f"Region: {region}")

    # Get agent pattern
    if args.pattern:
        pattern = args.pattern
    else:
        tfvars = parse_tfvars(tfvars_path)
        pattern = tfvars.get("backend_pattern", "strands-single-agent")

    log_info(f"Agent pattern: {pattern}")

    # Generate aws-exports.json
    log_info("Generating aws-exports.json...")
    try:
        generate_aws_exports(outputs, pattern, frontend_dir)
    except ValueError as e:
        log_error(str(e))
        return 1

    # Change to frontend directory
    os.chdir(frontend_dir)
    log_info(f"Working directory: {frontend_dir}")

    # Install dependencies if needed
    node_modules = frontend_dir / "node_modules"
    package_json = frontend_dir / "package.json"

    if not node_modules.exists() or (
        node_modules.exists()
        and package_json.exists()
        and package_json.stat().st_mtime > node_modules.stat().st_mtime
    ):
        log_info("Installing dependencies...")
        try:
            run_command(["npm", "install"], capture_output=False)
            log_success("Dependencies installed")
        except subprocess.CalledProcessError:
            log_error("Failed to install dependencies")
            return 1
    else:
        log_success("Dependencies are up to date")

    # Build frontend
    log_info("Building Next.js app...")
    try:
        run_command(["npm", "run", "build"], capture_output=False)
        log_success("Build completed")
    except subprocess.CalledProcessError:
        log_error("Build failed")
        return 1

    # Verify build directory
    build_dir = frontend_dir / NEXT_BUILD_DIR
    if not build_dir.exists():
        log_error(f"Build directory '{NEXT_BUILD_DIR}' not found")
        return 1

    # Copy aws-exports.json to build
    aws_exports_src = frontend_dir / "public" / "aws-exports.json"
    aws_exports_dst = build_dir / "aws-exports.json"
    shutil.copy2(aws_exports_src, aws_exports_dst)
    log_success("Added aws-exports.json to build directory")

    # Create deployment zip
    log_info("Creating deployment package...")
    zip_path = frontend_dir / "amplify-deploy.zip"
    CLEANUP_FILES.append(str(zip_path))

    create_deployment_zip(build_dir, zip_path)
    zip_size = get_file_size_human(str(zip_path))
    log_success(f"Package created ({zip_size})")

    # Upload to S3
    s3_key = f"amplify-deploy-{int(time.time())}.zip"
    log_info(f"Uploading to S3 (s3://{deployment_bucket}/{s3_key})...")
    try:
        upload_to_s3(str(zip_path), deployment_bucket, s3_key)
        log_success("Upload completed")
    except subprocess.CalledProcessError as e:
        log_error(f"S3 upload failed: {e.stderr}")
        return 1

    # Start Amplify deployment
    log_info("Starting Amplify deployment...")
    source_url = f"s3://{deployment_bucket}/{s3_key}"

    try:
        deployment = start_amplify_deployment(app_id, BRANCH_NAME, source_url)
        job_id = deployment["jobSummary"]["jobId"]
        log_success(f"Deployment initiated (Job ID: {job_id})")
    except subprocess.CalledProcessError as e:
        log_error(f"Amplify deployment failed: {e.stderr}")
        return 1

    # Poll deployment status
    log_info("Monitoring deployment status...")
    while True:
        try:
            status = get_amplify_job_status(app_id, BRANCH_NAME, job_id)
        except subprocess.CalledProcessError as e:
            log_error(f"Failed to get deployment status: {e.stderr}")
            return 1

        print(f"  Status: {status}")

        if status == "SUCCEED":
            log_success("Deployment completed successfully!")
            break
        elif status in ("FAILED", "CANCELLED"):
            log_error(f"Deployment {status.lower()}")
            return 1

        time.sleep(10)

    # Cleanup
    log_info("Cleaned up temporary files")

    # Print final info
    print()
    log_info(f"S3 Package: s3://{deployment_bucket}/{s3_key}")
    log_info("Console: https://console.aws.amazon.com/amplify/apps")
    try:
        app_domain = get_amplify_app_domain(app_id)
        log_info(f"App URL: https://{BRANCH_NAME}.{app_domain}")
    except subprocess.CalledProcessError:
        log_warning("Could not retrieve app URL - check Amplify console")

    print()
    print("========================================")
    print("  Frontend Deployment Complete!        ")
    print("========================================")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
