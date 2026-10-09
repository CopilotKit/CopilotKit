#!/usr/bin/env python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Interactive agent chat tester for local and remote agents

Tests agent invocation with conversation continuity:
- Remote mode (default): Chat with deployed agent via Cognito authentication
- Local mode (--local): Start the agent on localhost:8080 and chat with it
- Automatically detects pattern from config.yaml

Usage (run from examples/integrations/agentcore/):
    # Remote agent testing (prompts for credentials)
    uv run scripts/test-agent.py

    # Local agent testing (starts the agent on localhost:8080)
    uv run scripts/test-agent.py --local

    # Chat with an agent you started yourself on localhost:8080
    uv run scripts/test-agent.py --local --use-running-agent

    # Override pattern from config
    uv run scripts/test-agent.py --pattern strands-single-agent
"""

import argparse
import atexit
import os
import getpass
import json
import signal
import socket
import subprocess  # nosec B404 - subprocess used securely with explicit parameters
import sys
import time
from pathlib import Path
from typing import Dict, Optional

import requests
from colorama import Fore, Style

# Add scripts directory to path for reliable imports
scripts_dir = Path(__file__).parent.parent / "scripts"
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

# Import shared utilities
from utils import (
    authenticate_cognito,
    create_mock_jwt,
    generate_session_id,
    get_stack_config,
    print_msg,
    print_section,
)

# Global variable to track agent process
_agent_process: Optional[subprocess.Popen] = None


def generate_trace_id() -> str:
    """
    Generate X-Amzn-Trace-Id header value for AWS request tracing.

    Returns:
        str: Trace ID in AWS X-Ray format
    """
    timestamp_hex = format(int(time.time()), "x")
    return f"1-{timestamp_hex}-{generate_session_id()}"


def check_port_available(port: int = 8080) -> bool:
    """
    Check if a port is available for connection.

    Args:
        port (int): Port number to check

    Returns:
        bool: True if port is available, False otherwise
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    try:
        result = sock.connect_ex(("localhost", port))
        sock.close()
        return result == 0
    except Exception:
        return False


def start_local_agent(
    memory_id: str, region: str, stack_name: str, pattern: str
) -> subprocess.Popen:
    """
    Start the local agent in a background process.

    Args:
        memory_id (str): Memory ID for the agent
        region (str): AWS region
        stack_name (str): CloudFormation stack name for SSM parameter lookup
        pattern (str): Agent pattern name (e.g., 'strands-single-agent', 'langgraph-single-agent')

    Returns:
        subprocess.Popen: Subprocess object for the running agent
    """
    global _agent_process

    # Map pattern to agent file
    pattern_files = {
        "strands-single-agent": "strands_agent.py",
        "langgraph-single-agent": "langgraph_agent.py",
    }

    agent_file = pattern_files.get(pattern)
    if not agent_file:
        print_msg(f"Unknown pattern: {pattern}", "error")
        print(f"Available patterns: {', '.join(pattern_files.keys())}")
        sys.exit(1)

    agent_path = Path(__file__).parent.parent / "agents" / pattern / agent_file

    if not agent_path.exists():
        print_msg(f"Agent file not found: {agent_path}", "error")
        sys.exit(1)

    # Security validation: ensure agent_path is within the patterns directory
    patterns_dir = Path(__file__).parent.parent / "agents"
    try:
        agent_path.resolve().relative_to(patterns_dir.resolve())
    except ValueError:
        print_msg(
            f"Security error: Agent path outside patterns directory: {agent_path}",
            "error",
        )
        sys.exit(1)

    # Establish who owns port 8080 BEFORE announcing or spawning anything. This
    # is the only port check on the start path - main() deliberately does not
    # duplicate it - so this branch is always executed when the port is taken.
    # Note the real semantics of check_port_available(): it returns True when
    # the port ACCEPTS a connection, i.e. when the port is already OCCUPIED,
    # despite its name.
    #
    # Spawning anyway would produce a child that cannot bind, and a port
    # observed open afterwards would prove nothing about that child. Refusing is
    # the only outcome this script can report truthfully: short of a readiness
    # handshake it cannot tell its own agent from a stranger on the same port.
    if check_port_available(8080):
        print_msg("Port 8080 is already accepting connections", "error")
        print(
            "Something else is listening there, and this script cannot tell "
            "whether it is an agent."
        )
        print(
            "Stop that process, or re-run with --use-running-agent to send "
            "prompts to it as-is."
        )
        sys.exit(1)

    print(f"Starting local agent at {agent_path}...")
    print(f"  Pattern: {pattern}")
    print(f"  Memory ID: {memory_id}")
    print(f"  Region: {region}")
    print(f"  Stack Name: {stack_name}\n")

    # Set up environment variables
    env = {
        **dict(subprocess.os.environ),
        "MEMORY_ID": memory_id,
        "AWS_DEFAULT_REGION": region,
        "STACK_NAME": stack_name,
        "GATEWAY_CREDENTIAL_PROVIDER_NAME": f"{stack_name}-runtime-gateway-auth",
        "AGUI_ENABLED": "true",
        "PYTHONPATH": f"{agent_path.parent}{os.pathsep}{agent_path.parent.parent}",
    }

    # Run inside the agent's own uv project so the local agent gets exactly the
    # dependency set its container image ships. --locked fails fast if uv.lock
    # has fallen out of step with pyproject.toml rather than quietly resolving
    # something else.
    cmd = [
        "uv",
        "run",
        "--locked",
        "--project",
        str(agent_path.parent),
        str(agent_path),
    ]

    # Start agent process.
    #
    # The child's stdout/stderr are deliberately left inherited rather than
    # piped. Piping them without anyone draining the pipes deadlocks the child
    # as soon as it writes ~64KB (uv alone prints its resolution and install
    # progress to stderr before the agent starts), and reading such a pipe to
    # EOF while the child is still alive hangs the tester instead of reporting
    # the failure. Inheriting sends the agent's logs -- including the error
    # `uv run --locked` prints when uv.lock has drifted from pyproject.toml --
    # straight to the developer's terminal, live, which is what an interactive
    # tool wants anyway.
    try:
        _agent_process = subprocess.Popen(  # nosec B607 B603 - command constructed from validated path, shell=False
            cmd,
            env=env,
            shell=False,  # Explicitly disable shell
        )

        # Wait for agent to start (check port becomes available)
        print("Waiting for agent to start on port 8080...")
        for i in range(30):  # Wait up to 30 seconds
            # Liveness is checked FIRST. A child that has already exited (e.g.
            # `uv run --locked` aborting on a stale uv.lock) is reported as the
            # failure it is, rather than burning the full timeout - and, more
            # importantly, rather than being masked by a port check that some
            # other process happens to satisfy.
            exit_code = _agent_process.poll()
            if exit_code is not None:
                print_msg(
                    f"Agent exited with code {exit_code} before port 8080 opened",
                    "error",
                )
                print("See the agent/uv output above for the failure reason.")
                _agent_process = None
                sys.exit(1)

            # An open port is only evidence of THIS child because the refusal
            # above established the port was free immediately before the spawn.
            if check_port_available(8080):
                print_msg("Agent started successfully", "success")
                return _agent_process

            time.sleep(1)

        print_msg("Agent failed to start (timeout)", "error")
        print("See the agent/uv output above for the failure reason.")
        stop_local_agent()
        sys.exit(1)

    except Exception as e:
        print_msg(f"Failed to start agent: {e}", "error")
        sys.exit(1)


def stop_local_agent() -> None:
    """Stop the local agent process if running."""
    global _agent_process
    if _agent_process is None:
        return

    # Clear the global first so this stays idempotent: the timeout path, the
    # SIGINT handler and the atexit hook can all reach here for the same
    # process, and only the first one should do (and announce) the work.
    process, _agent_process = _agent_process, None

    print("\nStopping local agent...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    print_msg("Agent stopped", "success")


# Register cleanup handler
atexit.register(stop_local_agent)


def signal_handler(sig, frame):
    """Handle interrupt signal."""
    print("\n")
    stop_local_agent()
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)


def invoke_agent(
    url: str,
    prompt: str,
    session_id: str,
    user_id: str = "local-test-user",
    headers: Optional[Dict[str, str]] = None,
) -> bool:
    """
    Invoke agent and print raw streaming events in real-time.

    Returns:
        bool: True when the endpoint answered 200 and its stream was consumed
            without error, False when the exchange failed. This says the HTTP
            exchange succeeded, not that the reply was a useful agent answer.

    Args:
        url (str): Agent endpoint URL
        prompt (str): User prompt/query
        session_id (str): Session ID for conversation continuity
        user_id (str): User ID for mock JWT in local testing only. In remote mode,
            the real Cognito JWT carries the user identity, user_id is never sent
            in the payload to prevent prompt injection impersonation.
        headers (Optional[Dict[str, str]]): Optional HTTP headers
    """
    payload = {
        "prompt": prompt,
        "runtimeSessionId": session_id,
    }

    if headers is None:
        # Local mode: generate a mock JWT so the agent can extract user_id
        # from the Authorization header, matching the production auth flow.
        mock_token = create_mock_jwt(user_id)
        headers = {"Authorization": f"Bearer {mock_token}"}
    headers["Content-Type"] = "application/json"

    try:
        response = requests.post(
            url, headers=headers, json=payload, stream=True, timeout=60
        )

        if response.status_code != 200:
            print(f"Error: HTTP {response.status_code}: {response.text}")
            return False

        # Parse streaming events and display clean text output
        print(f"{Fore.GREEN}Agent:{Style.RESET_ALL} ", end="", flush=True)
        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            try:
                chunk = json.loads(line[6:])

                # LangGraph: AIMessageChunk with content array
                if chunk.get("type") == "AIMessageChunk" and isinstance(
                    chunk.get("content"), list
                ):
                    for block in chunk["content"]:
                        if block.get("type") == "text" and block.get("text"):
                            print(block["text"], end="", flush=True)
                        elif block.get("type") == "tool_use" and block.get("name"):
                            print(
                                f"\n{Fore.YELLOW}[Tool: {block['name']}]{Style.RESET_ALL} ",
                                end="",
                                flush=True,
                            )

                # LangGraph: ToolMessage result
                elif chunk.get("type") == "tool":
                    result = chunk.get("content", "")
                    if len(result) > 200:
                        result = result[:200] + "..."
                    print(
                        f"\n{Fore.YELLOW}[Result: {result}]{Style.RESET_ALL}",
                        flush=True,
                    )

                # Strands: text token
                elif isinstance(chunk.get("data"), str):
                    print(chunk["data"], end="", flush=True)

                # Strands: tool use
                elif chunk.get("current_tool_use") and chunk.get(
                    "current_tool_use", {}
                ).get("name"):
                    tool = chunk["current_tool_use"]
                    if chunk.get("delta", {}).get("toolUse", {}).get("input") == "":
                        print(
                            f"\n{Fore.YELLOW}[Tool: {tool['name']}]{Style.RESET_ALL} ",
                            end="",
                            flush=True,
                        )

                # Strands: tool result
                elif chunk.get("message", {}).get("role") == "user":
                    for content in chunk["message"].get("content", []):
                        if "toolResult" in content:
                            result = str(content["toolResult"].get("content", ""))
                            if len(result) > 200:
                                result = result[:200] + "..."
                            print(
                                f"\n{Fore.YELLOW}[Result: {result}]{Style.RESET_ALL}",
                                flush=True,
                            )

            except (json.JSONDecodeError, KeyError):
                continue
        print()  # Final newline
        return True

    except requests.exceptions.ConnectionError:
        print_msg(f"Could not connect to {url}", "error")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        return False


def run_chat(local_mode: bool, config: Dict[str, str]) -> None:
    """
    Run interactive chat session.

    Args:
        local_mode (bool): Whether to use local mode
        config (Dict[str, str]): Configuration dictionary
    """
    session_id = generate_session_id()

    print_section("Interactive Agent Chat")
    print(f"Session ID: {session_id}")
    print(
        f"Mode: {'Local (localhost:8080)' if local_mode else 'Remote (deployed agent)'}"
    )
    print(
        f"\n{Fore.YELLOW}💡 Type 'exit' or 'quit' to end, or press Ctrl+C{Style.RESET_ALL}\n"
    )

    while True:
        try:
            prompt = input(f"{Fore.CYAN}You:{Style.RESET_ALL} ").strip()

            if not prompt:
                continue

            if prompt.lower() in ["exit", "quit"]:
                print(f"\n{Fore.GREEN}Goodbye!{Style.RESET_ALL}")
                break

            # Invoke agent
            start_time = time.time()

            if local_mode:
                # Local mode
                succeeded = invoke_agent(
                    url="http://localhost:8080/invocations",
                    prompt=prompt,
                    session_id=session_id,
                    user_id="local-test-user",
                )
            else:
                # Remote mode
                endpoint = f"https://bedrock-agentcore.{config['region']}.amazonaws.com"
                escaped_arn = requests.utils.quote(config["runtime_arn"], safe="")
                url = f"{endpoint}/runtimes/{escaped_arn}/invocations?qualifier=DEFAULT"

                headers = {
                    "Authorization": f"Bearer {config['access_token']}",
                    "X-Amzn-Trace-Id": generate_trace_id(),
                    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
                }

                succeeded = invoke_agent(
                    url=url,
                    prompt=prompt,
                    session_id=session_id,
                    headers=headers,
                )

            # invoke_agent returning is not by itself evidence the exchange
            # worked - it returns on HTTP errors too - so report what actually
            # happened rather than always announcing completion.
            elapsed = time.time() - start_time
            outcome = "Completed" if succeeded else "Failed"
            colour = Fore.CYAN if succeeded else Fore.RED
            print(f"\n{colour}[{outcome} in {elapsed:.2f}s]{Style.RESET_ALL}\n")

        except KeyboardInterrupt:
            print(f"\n\n{Fore.GREEN}Goodbye!{Style.RESET_ALL}")
            break
        except EOFError:
            print(f"\n\n{Fore.GREEN}Goodbye!{Style.RESET_ALL}")
            break


def parse_arguments() -> argparse.Namespace:
    """
    Parse command-line arguments.

    Returns:
        argparse.Namespace: Parsed arguments
    """
    parser = argparse.ArgumentParser(
        description="Interactive agent chat tester (local or remote)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Remote agent (prompts for credentials)
  uv run scripts/test-agent.py
  
  # Local agent on localhost:8080 (uses pattern from config.yaml)
  uv run scripts/test-agent.py --local
  
  # Override pattern for local testing
  uv run scripts/test-agent.py --local --pattern strands-single-agent

  # Chat with an agent you started yourself on localhost:8080
  uv run scripts/test-agent.py --local --use-running-agent

Notes:
  - Run from examples/integrations/agentcore/
  - Remote mode: Tests deployed agent
  - Local mode: Pattern read from config.yaml at the example root (next to
    config.yaml.example) to start the correct agent
  - Use --pattern to override the config value for local testing
  - Always runs in interactive conversation mode
        """,
    )

    parser.add_argument(
        "--local",
        action="store_true",
        help="Test local agent on localhost:8080 (default: remote)",
    )

    parser.add_argument(
        "--pattern",
        type=str,
        help="Override agent pattern from config (e.g., 'strands-single-agent', 'langgraph-single-agent')",
    )

    parser.add_argument(
        "--use-running-agent",
        action="store_true",
        help=(
            "With --local, send prompts to whatever is already listening on "
            "localhost:8080 instead of starting an agent. This script cannot "
            "verify that process is an agent, so it is opt-in."
        ),
    )

    args = parser.parse_args()

    # Reject rather than silently ignore: remote mode never touches port 8080,
    # so honouring the flag there would be a no-op the user could not see.
    if args.use_running_agent and not args.local:
        parser.error("--use-running-agent only applies to --local")

    return args


def main():
    """Main entry point."""
    print("=" * 60)
    print("AgentCore Interactive Chat Tester")
    print("=" * 60 + "\n")

    args = parse_arguments()
    config: Dict[str, str] = {}

    # Get stack configuration
    stack_cfg = get_stack_config()

    # LOCAL MODE
    if args.local:
        # Determine pattern: CLI arg > config.yaml > default (only needed for local mode)
        pattern = (
            args.pattern
            if args.pattern
            else stack_cfg.get("pattern", "langgraph-single-agent")
        )
        if args.use_running_agent:
            # No agent is started here, so neither the banner nor the pattern
            # should claim otherwise.
            print_section("LOCAL MODE - using the process already on port 8080")
        else:
            print(f"Using pattern: {pattern}\n")
            print_section("LOCAL MODE - Auto-starting agent")

        # Get memory configuration
        memory_arn = stack_cfg["outputs"]["MemoryArn"]
        memory_id = memory_arn.split("/")[-1]
        region = stack_cfg["region"]
        stack_name = stack_cfg["stack_name"]

        # A TCP connect to 8080 succeeding only establishes that SOME process
        # is listening there - not that it is this example's agent. Adopting a
        # listener this script did not start is therefore opt-in and labelled
        # as unverified, never announced as "the agent". Without the flag the
        # port is not probed here at all: start_local_agent() owns that check
        # and refuses on an occupied port.
        if args.use_running_agent:
            if not check_port_available(8080):
                print_msg(
                    "--use-running-agent was passed, but nothing is accepting "
                    "connections on localhost:8080",
                    "error",
                )
                print(
                    "Start an agent there yourself, or drop the flag to have "
                    "this script start one."
                )
                sys.exit(1)
            print_msg(
                "Sending prompts to the process already listening on "
                "localhost:8080",
                "info",
            )
            print(
                "This script did not start it and cannot verify it is an "
                "agent - replies below come from that process, whatever it is.\n"
            )
        else:
            # Start the agent
            start_local_agent(memory_id, region, stack_name, pattern)

    # REMOTE MODE
    else:
        print_section("REMOTE MODE - Testing deployed agent")

        stack_cfg = get_stack_config()
        print(f"Stack: {stack_cfg['stack_name']}\n")

        # Get configuration from CloudFormation outputs
        print("Fetching configuration from stack outputs...")
        outputs = stack_cfg["outputs"]

        # Validate required outputs exist
        required_outputs = ["CognitoUserPoolId", "CognitoClientId", "RuntimeArn"]
        missing = [key for key in required_outputs if key not in outputs]
        if missing:
            print_msg(f"Missing required stack outputs: {', '.join(missing)}", "error")
            sys.exit(1)

        print_msg("Configuration fetched")

        runtime_arn = outputs["RuntimeArn"]
        region = stack_cfg["region"]

        # Get credentials
        print_section("Authentication")

        username = input("Enter username: ").strip()
        if not username:
            print_msg("Username is required", "error")
            sys.exit(1)
        password = getpass.getpass(f"Enter password for {username}: ")

        # Authenticate
        access_token, id_token, user_id = authenticate_cognito(
            outputs["CognitoUserPoolId"], outputs["CognitoClientId"], username, password
        )

        # Use access token for AgentCore runtime (JWT authorizer)
        config["access_token"] = access_token
        config["runtime_arn"] = runtime_arn
        config["region"] = region
        print(f"\nRuntime ARN: {runtime_arn}")
        print(f"Region: {region}\n")

    # Run interactive chat
    run_chat(args.local, config)


if __name__ == "__main__":
    main()
