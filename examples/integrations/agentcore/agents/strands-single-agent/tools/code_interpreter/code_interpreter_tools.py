"""Core Code Interpreter tools for AgentCore."""

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging

logger = logging.getLogger(__name__)


class CodeInterpreterTools:
    """Tools for code execution via AgentCore Code Interpreter."""

    def __init__(self, region: str):
        """
        Initialize the code interpreter tools.

        Args:
            region: AWS region for code interpreter
        """
        self.region = region
        self._code_client = None

    def _get_code_interpreter_client(self):
        """Get or create code interpreter client."""
        if self._code_client is None:
            from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

            self._code_client = CodeInterpreter(self.region)
            self._code_client.start()
            logger.info(f"Started code interpreter in {self.region}")
        return self._code_client

    def cleanup(self):
        """
        Clean up code interpreter session.

        Note: AgentCore automatically cleans up inactive sessions after timeout,
        so manual cleanup is optional but recommended for immediate resource release.
        """
        if self._code_client:
            self._code_client.stop()
            self._code_client = None

    def execute_python_securely(self, code: str) -> str:
        """
        Execute Python code in a secure AgentCore CodeInterpreter sandbox.

        Args:
            code: Python code to execute

        Returns:
            JSON string with execution result
        """
        client = self._get_code_interpreter_client()
        try:
            response = client.invoke(
                "executeCode",
                {"code": code, "language": "python", "clearContext": False},
            )

            results = []
            for event in response["stream"]:
                if "result" in event:
                    results.append(event["result"])

            return (
                json.dumps(results, indent=2)
                if results
                else json.dumps({"error": "No results returned"}, indent=2)
            )
        except Exception as e:
            logger.error(f"Code execution failed: {e}")
            return json.dumps({"error": f"Code execution failed: {str(e)}"}, indent=2)
